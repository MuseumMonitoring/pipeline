import { Processor, Reader, Writer } from "@rdfc/js-runner";
import { Entry } from "./fetch";
import { Quad, Quad_Object, Term } from "@rdfjs/types";
import { cidoc, isotc, mumoData, qudt, sosa } from "./ontologies";
import { DataFactory, Quad_Subject } from "n3";
import * as N3 from "n3";
import { RDF, RDFS, XSD } from "@treecg/types";
const { quad, literal, blankNode } = DataFactory;

type Brand = {
    name: string,
    kind: string,
}

const brands: { [id: string]: Brand[] } = {};
(<[string, string[]][]>[
    ["internal", ["volatage", "percentcharged"]],
    ["bme680", ["temperature", "humidity", "pressure"]],
    ["tsl2591", ["lux"]],
    ["sht40", ["temperature", "humidity"]],
    ["lis3dh", []],
    ["sths34", []],
    ["scd40", ["temperature", "humidity", "CO2"]],
    ["sps30", []],
    ["xs1110", ["latitude", "longitude"]],
    // DeviceIndex 999
    ["base", ["battery", "temperature", "humidity", "lux", "pressure", "voc", "dust"]],
]).forEach(([name, kinds], i, brandsArr) => {
    if (i === brandsArr.length - 1) {
        i = 999;
    } else {
        i = i + 1;
    }
    const things = kinds.map(kind => ({ name, kind }));
    brands[i + ""] = things;
});

function brandId(sensor: Sensor, brand: Brand): Term {
    return mumoData.custom(`sensor/${sensor.device_EUI}/${brand.name}-${brand.kind}`);
}
function brandObserves(brand: Brand): Term {
    return mumoData.custom(`kind/${brand.kind}`)
}


type Sensor = {
    id: number,
    device_ID: number,
    device_EUI: string,
    name: string | undefined,
    url: string | undefined,
    recorded_at: Date
}

type History = { sensor: Sensor, recorded_at: Date }[];

type Data = {
    id: number,
    device_ID: number,
    timestamp: string,
    deviceIndex: number,
    channelIndex: number,
    value: number,
}


function sensorFor(history: History, date: Date, returnFirst = false) {
    const out = history.find(x => x.recorded_at < date)?.sensor
    if (!out && returnFirst) {
        const out = history[0]?.sensor;
        if (out) {
            console.log("Just returned the first sensor (time: " + out.recorded_at.toISOString() + ") with incoming date " + date.toISOString());

        }
        return out;
    }
    return out;
}

type MapperArgs = {
    trigger: Writer,
    data: {
        reader: Reader,
        writer: Writer,
    },
    sensor: {
        reader: Reader,
        writer: Writer,
    },
}

export class Mapper extends Processor<MapperArgs> {
    sensorData: { [eui: string]: History } = {}

    async init(this: MapperArgs & this): Promise<void> {
    }

    async transform(this: MapperArgs & this): Promise<void> {
        await this.setupSensor(this.sensor.reader);

        this.logger.debug("Would setup data");
        const prom = this.setupData(this.data.reader);
        this.trigger.close();
        await prom;
        this.logger.debug(JSON.stringify(this.sensorData, undefined, 2))
    }

    async produce(this: MapperArgs & this): Promise<void> {
        // Nothing to produce
    }

    observation(data: Data, sensor: Sensor, done: Set<string>): Quad[] | undefined {
        const mBrand = brands[data.deviceIndex];
        const brand = mBrand ? mBrand[data.channelIndex] : undefined;

        const quads: Quad[] = [];
        const resultId = blankNode();

        if (!brand) {
            this.logger.error("No brand found for " + JSON.stringify({ data, sensor }));
            return;
        } else {
            this.logger.debug(JSON.stringify({ brand }))
        }
        const subj = mumoData.custom(
            `${sensor.device_EUI}/${brand.name}/${brand.kind}/${data.timestamp}`
        );


        quads.push(quad(subj, RDF.terms.type, isotc.OM_Observation));
        quads.push(
            quad(
                subj,
                isotc["OM_Observation.resultTime"],
                literal(new Date(data.timestamp).toISOString(), XSD.terms.dateTime),
            ),
        );
        quads.push(quad(subj, isotc["OM_Observation.result"], resultId));
        const sensorId = brandId(sensor, brand);
        quads.push(quad(subj, sosa.madeBySensor, <Quad_Object>sensorId));
        // This is incorrect
        quads.push(quad(<Quad_Subject>sensorId, cidoc.P55_has_current_location, literal("group-" + sensor.id)));

        quads.push(quad(resultId, RDF.terms.type, qudt.QuantityValue));
        const observes = brandObserves(brand);
        quads.push(
            quad(resultId, qudt.unit, <Quad_Object>observes),
        );
        quads.push(
            quad(
                <Quad_Subject>observes,
                RDFS.terms.label,
                literal(mumoData.custom(brand.kind).value),
            ),
        );
        quads.push(
            quad(
                resultId,
                qudt.numericValue,
                literal(data.value, XSD.terms.custom("float")),
            ),
        );

        console.log("Adding measurement", subj.value);
        return quads;
    }

    setupSensor(this: MapperArgs & this, sensors: Reader): Promise<void> {
        return new Promise(async res => {
            for await (const st of sensors.strings()) {
                const entity = <Entry<Sensor>>JSON.parse(st);
                switch (entity.type) {
                    case "poll":
                        res()
                        break
                    case "entity":
                        if (!this.sensorData[entity.object.device_ID]) {
                            this.sensorData[entity.object.device_ID] = [];
                        }
                        entity.object.recorded_at = new Date(entity.object.recorded_at);
                        this.sensorData[entity.object.device_ID]!.unshift({
                            recorded_at: new Date(entity.object.recorded_at),
                            sensor: entity.object
                        });
                        break;
                }
            }
        })
    }

    async setupData(this: MapperArgs & this, data: Reader): Promise<void> {
        const done = new Set<string>();
        for await (const obj of data.strings()) {
            try {
                const entity = <Entry<Data>>JSON.parse(obj);
                if (entity.type === "entity") {
                    const thing = entity.object;
                    console.log("THING", thing.id, entity.idx, entity.idx2)

                    const sensor = sensorFor(this.sensorData[thing.device_ID]!, new Date(thing.timestamp), true);

                    if (sensor === undefined) {
                        this.logger.error("No sensor found with id " + thing.device_ID + ` (found ${this.sensorData[thing.device_ID]!.length})`);
                        continue;
                    }

                    const quads = this.observation(thing, sensor, done)

                    if (quads !== undefined) {
                        await this.data.writer.string(
                            new N3.Writer().quadsToString(quads)
                        );
                    }
                }
            } catch (ex: unknown) {
                this.logger.error("Error " + JSON.stringify(ex));
            }
        }
    }
}
