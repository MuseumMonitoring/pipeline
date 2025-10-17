import { Quad, Quad_Graph, Quad_Object, Quad_Predicate, Quad_Subject, Term } from "@rdfjs/types";

import { DataFactory } from "n3";
const { quad, blankNode } = DataFactory;

export class Builder {
    readonly id: Term;
    readonly quads: Quad[];
    readonly graph: Term | undefined;
    constructor(id: Term, quads: Quad[], graph?: Term) {
        this.id = id;
        this.quads = quads;
        this.graph = graph;
    }

    triple(pred: Term): Builder;
    triple(pred: Term, object: Term): Builder;
    triple(pred: Term, object?: Term): Builder {
        const o = object === undefined ? blankNode() : object;
        this.quads.push(quad(<Quad_Subject>this.id, <Quad_Predicate>pred, <Quad_Object>o, <Quad_Graph>this.graph));
        return new Builder(o, this.quads, this.graph);
    }

    tripleThis(pred: Term): Builder;
    tripleThis(pred: Term, object: Term): Builder;
    tripleThis(pred: Term, object?: Term): Builder {
        const o = object === undefined ? blankNode() : object;
        this.quads.push(quad(<Quad_Subject>this.id, <Quad_Predicate>pred, <Quad_Object>o, <Quad_Graph>this.graph));
        return this;
    }
}
