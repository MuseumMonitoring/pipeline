"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sensor_device_payload = sensor_device_payload;
exports.sensor_payload = sensor_payload;
exports.createItem = createItem;
function sensor_device_payload(device) {
    const payload = {
        "@context": "https://heron.libis.be/momu-test/api-context",
        "@type": ["o:Item"],
        "o:resource_class": {
            "o:id": 32,
        },
        "o:resource_template": {
            "o:id": 31,
        },
        "o:item_set": [34042],
        "dcterms:title": [
            {
                property_id: 1,
                "@value": device.title,
                type: "literal",
            },
        ],
        "dcterms:publisher": [
            {
                property_id: 5,
                type: "literal",
                "@value": device.publisher,
            },
        ],
        "dcterms:issued": [
            {
                property_id: 23,
                type: "literal",
                "@value": device.issued,
            },
        ],
    };
    return JSON.stringify(payload);
}
function sensor_payload(device) {
    const isPartOfIds = device.isPartOf.split("/");
    const payload = {
        "@context": "https://heron.libis.be/momu-test/api-context",
        "@type": ["o:Item", "sosa:Sensor"],
        "o:resource_class": {
            "o:id": 525,
        },
        "o:resource_template": {
            "o:id": 30,
        },
        "o:item_set": [34042],
        "dcterms:title": [
            {
                property_id: 1,
                "@value": device.title,
                type: "literal",
            },
        ],
        isPartOf: [
            {
                property_id: 33,
                type: "resource:item",
                "@id": device.isPartOf,
                value_resource_id: isPartOfIds[isPartOfIds.length - 1],
                value_resource_name: "items",
            },
        ],
        identifier: [
            {
                property_id: 10,
                type: "literal",
                "@value": device.identifier,
            },
        ],
        feature: [
            {
                property_id: 1648,
                type: "uri",
                "@id": device.feature,
            },
        ],
    };
    return JSON.stringify(payload);
}
function createItem(payload, url, fetch_f) {
    return __awaiter(this, void 0, void 0, function* () {
        const resp = yield fetch_f(url, {
            body: payload,
            method: "POST",
            headers: { "Content-Type": "application/ld+json" },
        });
        const json = yield resp.json();
        return json["@id"];
    });
}
