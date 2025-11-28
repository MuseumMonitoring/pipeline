// export * from "./src/fetch";
// export * from "./src/mapper";
// export * from "./src/sensors";
// export * from "./src/omeka";

import {
  CONTENT_TYPE,
  guardedStreamFrom,
  INTERNAL_QUADS,
  RepresentationMetadata,
  type DataAccessor,
  type Guarded,
  type Representation,
  type ResourceIdentifier,
} from "@solid/community-server";
import { Parser } from "n3";
import type { Readable } from "stream";

export class ProxyDataAccessor implements DataAccessor {
  private readonly proxy: string;

  constructor(proxy: string) {
    this.proxy = proxy;
    console.log("Starting with proxy", proxy);
  }

  async getData(identifier: ResourceIdentifier): Promise<Guarded<Readable>> {
    try {
      console.log("get data for", identifier.path);
      const req = await fetch(this.proxy, {
        body: JSON.stringify(identifier),
        headers: { accept: "text/turtle", "content-type": "application/json" },
        method: "POST",
      });

      const str = await req.text();

      console.log("found str\n" + str);

      const quads = new Parser({ baseIRI: identifier.path }).parse(str);

      return guardedStreamFrom(quads);
    } catch (ex) {
      if (ex instanceof Error) {
        console.log(ex.name, ex.message, ex.cause);
        console.log(ex.stack);
      }
      return guardedStreamFrom([]);
    }
  }

  async getMetadata(
    identifier: ResourceIdentifier,
  ): Promise<RepresentationMetadata> {
    const out = new RepresentationMetadata(identifier, {
      [CONTENT_TYPE]: INTERNAL_QUADS,
    });
    return out;
  }

  async canHandle(representation: Representation) {
    console.log("can handle");
  }
  async *getChildren(
    identifier: ResourceIdentifier,
  ): AsyncIterableIterator<RepresentationMetadata> {
    console.log("Get children", identifier.path);
  }

  async writeDocument(
    identifier: ResourceIdentifier,
    data: Guarded<Readable>,
    metadata: RepresentationMetadata,
  ): Promise<void> {
    throw "nah";
  }
  async writeContainer(
    identifier: ResourceIdentifier,
    metadata: RepresentationMetadata,
  ): Promise<void> {
    throw "nah";
  }
  async writeMetadata(
    identifier: ResourceIdentifier,
    metadata: RepresentationMetadata,
  ): Promise<void> {
    throw "nah";
  }
  async deleteResource(identifier: ResourceIdentifier): Promise<void> {
    throw "nah";
  }
}
