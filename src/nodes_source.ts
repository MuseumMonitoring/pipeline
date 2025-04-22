import { Processor, Writer } from "@rdfc/js-runner";
import { MyNodes, setup_nodes } from "./mapper";
import { getOmeka, Omeka } from "./omeka";
import { Writer as N3Writer } from "n3";

async function once(
  nodes: MyNodes,
  omeka: Omeka,
  writer: Writer,
  interval: number,
) {
  while (true) {
    console.log("Getting nodes");
    await setup_nodes(nodes, omeka);
    for (const node of Object.values(nodes)) {
      const quads = await node.node.getQuads(true, false);
      const quads_str = new N3Writer().quadsToString(quads);
      await writer.string(quads_str);
    }

    await new Promise((res) => setTimeout(res, interval));
  }
}

type Args = {
  output: Writer;
  interval: number;
  api: string;
};

export class Source extends Processor<Args> {
  nodes: MyNodes = {};
  omeka!: Omeka;
  async init(this: Args & this): Promise<void> {
    this.api = this.api ?? "https://heron.libis.be/momu-test/api";
    this.interval = this.interval ?? 60000;
    this.omeka = await getOmeka(this.api);
  }
  async transform(this: Args & this): Promise<void> {
  }
  async produce(this: Args & this): Promise<void> {
    await once(this.nodes, this.omeka, this.output, this.interval);
  }
}

// export async function source(
//   writer: Writer<string>,
//   interval: number = 60000,
//   api: string = "https://heron.libis.be/momu-test/api",
// ) {
//   const nodes: MyNodes = {};
//   const omeka = await getOmeka(api);
//
//   return () => {
//     once(nodes, omeka, writer, interval);
//   };
// }
