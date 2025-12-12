import { readFileSync, writeFileSync } from "fs";
import fetch, { Headers } from "node-fetch";
import { Processor, Reader, Writer } from "@rdfc/js-runner";

export type Data<T = unknown> = {
    page: number,
    page_size: number,
    total_records: number,
    history: T[],
}

function extract_links(headers: Headers): Link[] {
    // link = </ingest/?index=1514>; rel="next", </ingest/?index=1512>; rel="prev"
    const link = headers.get("link");
    if (!link) return [];

    const out: Link[] = [];

    for (let l of link.split(",")) {
        let [key, ...vals] = l.split(";");
        if (!key || !vals) continue;

        const url = key.trim().slice(1, -1);

        for (const val of vals) {
            const [val_key, val_val] = val.split("=");

            if (!val_key || !val_val) continue;
            if (val_key.trim().toLowerCase() !== "rel") continue;
            const target = val_val.trim().replaceAll('"', "");

            out.push({ target, url });
        }
    }

    return out;
}

class Fetched {
    data: Data;
    links: Link[];
    url: string;

    private constructor(data: Data, links: Link[], url: string) {
        this.data = data;
        this.links = links;
        this.url = url;
    }

    public static async fetch(url: string): Promise<Fetched> {
        console.log("Producing url", url);
        const resp = await fetch(url);
        const links = extract_links(resp.headers);
        const object = <Data>await resp.json();
        return new Fetched(object, links, url);
    }

    nextUrl(): string | undefined {
        const next = this.links.find((x) => x.target === "next");
        if (next) {
            const url_url = new URL(
                next.url,
                this.url
            );
            return url_url.href;
        }
    }

    finished(): boolean {
        return this.data.page_size == this.data.history.length;
    }
}

export type Entry<T = unknown> = {
    type: "poll"
} | {
    type: "entity",
    object: T,
    idx: number
    idx2: number
}

interface Link {
    target: string;
    url: string;
}


type FetchArgs = {
    writer: Writer,
    start_url: string,
    delayed?: Reader,
    save_path: string | undefined,
    interval_ms: number,
    stop: boolean,
}

export class Fetcher extends Processor<FetchArgs> {
    private at: number = 0;

    private current!: Fetched;
    private waitFor!: Promise<void>;

    async init(this: FetchArgs & this): Promise<void> {
        this.save_path = this.save_path ? this.save_path.substring(7) : undefined;
        this.logger.debug("Init");
        this.interval_ms = this.interval_ms ?? 1000;
        this.stop = this.stop ?? false;

        let start = this.start_url;
        if (this.save_path) {
            try {
                const { url, at }: { url: string, at: number } = JSON.parse(readFileSync(this.save_path, { encoding: "utf8" }));
                start = url;
                this.at = at;
            } catch (ex: any) {
                if(ex instanceof Error) {
                    console.log(ex.name, ex.message, ex.cause)
                    console.log(ex.stack)
                }

            }
        }

        this.current = await Fetched.fetch(start);
    }

    async transform(this: FetchArgs & this): Promise<void> {
        if (this.delayed) {
            this.waitFor = (async () => {
                for await (const v of this.delayed!.anys()) {
                    this.logger.error("Didn't expect a message, but got " + JSON.stringify(v))
                }
            })();
        } else {
            this.waitFor = Promise.resolve();
        }
    }

    async produce(this: FetchArgs & this): Promise<void> {
        await this.waitFor;

        this.logger.debug("Starting for real " + this.current.url);
        while (true) {
            const object = this.current.data;
            const offset = ((object.page - 1) * object.page_size)
            let i = 0;

            for (const o of object.history) {
                i += 1;
                if (i + offset <= this.at) {
                    this.logger.debug("Already seen " + (i + offset) + " / " + this.at)
                    continue
                }

                this.at += 1;

                await this.writer.string(JSON.stringify(<Entry>{ object: o, type: "entity", idx: this.at, idx2: i + offset }));
                this.save();
            }

            await this.next();
        }
    }

    async next(this: FetchArgs & this) {
        if (this.current.finished()) {
            let url = this.current.nextUrl();
            while (!url) {
                await this.writer.string(JSON.stringify(<Entry>{ type: "poll" }));
                this.logger.debug("Waiting some " + this.interval_ms + " ms")
                await new Promise(res => setTimeout(res, this.interval_ms))
                this.current = await Fetched.fetch(this.current.url);
                url = this.current.nextUrl();
            }
            this.logger.debug("fetching " + url)
            this.current = await Fetched.fetch(url);
        } else {
            await this.writer.string(JSON.stringify(<Entry>{ type: "poll" }));
            await new Promise(res => setTimeout(res, this.interval_ms))
            this.logger.debug("refetching " + this.current.url)
            this.current = await Fetched.fetch(this.current.url);
        }
    }

    save(this: FetchArgs & this) {
        if (this.save_path) {
            const state = {
                url: this.current.url,
                at: this.at,
            }
            writeFileSync(this.save_path, JSON.stringify(state), { encoding: "utf8" });
        }
    }
}
