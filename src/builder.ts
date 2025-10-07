import { Quad, Quad_Object, Quad_Predicate, Quad_Subject, Term } from "@rdfjs/types";

import { DataFactory } from "n3";
const { quad, blankNode } = DataFactory;

export class Builder {
    readonly id: Term;
    readonly quads: Quad[];
    constructor(id: Term, quads: Quad[]) {
        this.id = id;
        this.quads = quads;
    }

    triple(pred: Term): Builder;
    triple(pred: Term, object: Term): Builder;
    triple(pred: Term, object?: Term): Builder {
        const o = object === undefined ? blankNode() : object;
        this.quads.push(quad(<Quad_Subject>this.id, <Quad_Predicate>pred, <Quad_Object>o));
        return new Builder(o, this.quads);
    }

    tripleThis(pred: Term): Builder;
    tripleThis(pred: Term, object: Term): Builder;
    tripleThis(pred: Term, object?: Term): Builder {
        const o = object === undefined ? blankNode() : object;
        this.quads.push(quad(<Quad_Subject>this.id, <Quad_Predicate>pred, <Quad_Object>o));
        return this;
    }
}
