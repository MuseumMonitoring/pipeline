import { Processor, Reader, Writer } from "@rdfc/js-runner";
import { Entry } from "./fetch";
import { Quad, Quad_Object, Term } from "@rdfjs/types";
import { cidoc, DCTERMS, isotc, mumoData, qudt, sosa, skos } from "./ontologies";
import { DataFactory } from "n3";
import * as N3 from "n3";
import { DC, RDF, RDFS, XSD } from "@treecg/types";
import { Builder } from "./builder";
const { literal } = DataFactory;

type Brand = {
    name: string,
    kind: string,
}

const brands: { [id: string]: Brand[] } = {};
const brandNames: { [id: string]: Brand[] } = {};

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
    brandNames[name] = things;
});

function brandId(sensor: Sensor, brand: Brand): Term {
    return mumoData.custom(`sensor/${sensor.device_EUI}/${brand.name}-${brand.kind}`);
}
function brandPartOf(sensor: Sensor, brand: Brand): Term {
    return mumoData.custom(`sensor/${sensor.device_EUI}/${brand.name}`);
}
function platformId(sensor: Sensor): Term {
    return mumoData.custom(`sensor/${sensor.device_EUI}`);
}
function versionedPlatformId(sensor: Sensor, date: Date) {
    return mumoData.custom(`sensor/${sensor.device_EUI}/${date.toISOString()}`);
}
function brandObserves(brand: Brand): Term {
    return mumoData.custom(`kind/${brand.kind}`)
}


type Sensor = {
    id: number,
    device_ID: number,
    device_EUI: string,
    brands: string[] | undefined,
    group_ID?: string,
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

    sensorsAreSetup: Promise<void> = new Promise(() => { });;

    async init(this: MapperArgs & this): Promise<void> {
    }

    async transform(this: MapperArgs & this): Promise<void> {

        this.sensorsAreSetup = this.setupSensor(this.sensor.reader, this.sensor.writer);

        // This should go when backpressure is implemented
        await this.sensorsAreSetup;

        this.logger.debug("Would setup data");
        const prom = this.setupData(this.data.reader);

        // This should go when backpressure is implemented
        this.trigger.close();
        await prom;
        this.logger.debug(JSON.stringify(this.sensorData, undefined, 2))
    }

    async produce(this: MapperArgs & this): Promise<void> {
        // Nothing to produce
    }

    sensorQuads(sensor: Sensor): Quad[] | undefined {
        const quads: Quad[] = [];

        const id = versionedPlatformId(sensor, sensor.recorded_at);
        const builder = new Builder(id, quads, id)
            .tripleThis(RDF.terms.type, sosa.Platform)
            .tripleThis(DCTERMS.isVersionOf, platformId(sensor))
            .tripleThis(DCTERMS.modified, literal(sensor.recorded_at.toISOString(), XSD.terms.dateTime))
            .tripleThis(DCTERMS.identifier, literal(sensor.device_EUI))
            .tripleThis(RDFS.terms.label, literal("sensor-" + sensor.device_ID));

        if (sensor.group_ID) {
            builder.triple(cidoc.P55_has_current_location, literal("group-" + sensor.group_ID));
        }
        if(sensor.name) {
            builder.triple(skos.prefLabel, literal(sensor.name));
        }
        const foundBrands = (sensor.brands || []).flatMap(b => brandNames[b] || []);
        for (const brand of foundBrands) {
            const b = builder.triple(sosa.hosts, brandId(sensor, brand))
                .tripleThis(RDF.terms.type, sosa.Sensor)
                .tripleThis(DC.terms.custom("isPartOf"), brandPartOf(sensor, brand))
                .tripleThis(RDFS.terms.label, literal(`${brand.name}-${brand.kind}`));

            b.triple(sosa.observes, brandObserves(brand))
                .tripleThis(RDF.terms.type, sosa.ObservableProperty)
                .tripleThis(RDFS.terms.label, literal(brand.kind));
        }

        return quads;
    }

    observation(data: Data, sensor: Sensor, done: Set<string>): Quad[] | undefined {
        const mBrand = brands[data.deviceIndex];
        const brand = mBrand ? mBrand[data.channelIndex] : undefined;
        const quads: Quad[] = [];

        if (!brand) {
            this.logger.error("No brand found for " + JSON.stringify({ data, sensor }));
            return;
        }

        const subj = mumoData.custom(
            `${sensor.device_EUI}/${brand.name}/${brand.kind}/${data.timestamp.replaceAll(' ', 'Z')}`
        );
        const measurement = new Builder(subj, quads)
            .tripleThis(RDF.terms.type, isotc.OM_Observation)
            .tripleThis(isotc["OM_Observation.resultTime"],
                literal(new Date(data.timestamp).toISOString(), XSD.terms.dateTime));

        measurement.triple(isotc["OM_Observation.result"])
            .tripleThis(RDF.terms.type, qudt.QuantityValue)
            .tripleThis(qudt.numericValue, literal(data.value, XSD.terms.custom("float")))
            .triple(qudt.unit, brandObserves(brand))
            .tripleThis(RDFS.terms.label, literal(mumoData.custom(brand.kind).value));

        const platformBuilder = measurement.triple(sosa.madeBySensor, <Quad_Object>brandId(sensor, brand))
            .triple(sosa.isHostedBy, platformId(sensor))
            .tripleThis(RDFS.terms.label, literal("sensor-" + sensor.id));

        if (sensor.group_ID) {
            platformBuilder.triple(cidoc.P55_has_current_location, literal("group-" + sensor.group_ID));
        }

        this.logger.info("Adding measurement", subj.value);

        return quads;
    }

    setupSensor(this: MapperArgs & this, sensors: Reader, writer: Writer): Promise<void> {
        return new Promise(async res => {
            for await (const st of sensors.strings()) {
                const entity = <Entry<Sensor>>JSON.parse(st);
                switch (entity.type) {
                    case "poll":
                        res()
                        break
                    case "entity":
                        const sensor = entity.object;
                        if (!this.sensorData[sensor.device_ID]) {
                            this.sensorData[sensor.device_ID] = [];
                        }
                        sensor.recorded_at = new Date(sensor.recorded_at);
                        this.sensorData[sensor.device_ID]!.unshift({
                            recorded_at: new Date(sensor.recorded_at),
                            sensor
                        });

                        sensor.brands = ["internal", "bme680"];
                        const quads = this.sensorQuads(sensor);
                        if (quads !== undefined) {
                            await writer.string(
                                new N3.Writer().quadsToString(quads)
                            );
                        }

                        break;
                }
            }
        })
    }

    async setupData(this: MapperArgs & this, data: Reader): Promise<void> {
        const done = new Set<string>();
        for await (const obj of data.strings()) {
            await this.sensorsAreSetup;
            try {
                const entity = <Entry<Data>>JSON.parse(obj);
                if (entity.type === "entity") {
                    const thing = entity.object;
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
                // Ignore poll events, we don't care
            } catch (ex: unknown) {
                this.logger.error("Error " + JSON.stringify(ex));
            }
        }
    }
}

