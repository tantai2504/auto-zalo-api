import { Router } from "express";
import {
    getAllMethodDocs,
    getMethodDocs,
    groupedFullDocs,
} from "../zalo/methodDocs.js";
import { fail, ok } from "../http/response.js";

export const methodsRouter: Router = Router();

/** GET /methods — full catalog with signatures + Vietnamese docs + examples. */
methodsRouter.get("/", (_req, res) => {
    const all = getAllMethodDocs();
    ok(res, { total: all.length, groups: groupedFullDocs() });
});

/** GET /methods/:name — single method full doc. */
methodsRouter.get("/:name", (req, res) => {
    const name = req.params.name;
    if (!name || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) {
        return fail(res, "VALIDATION_ERROR", "Invalid method name");
    }
    const doc = getMethodDocs(name);
    if (!doc) return fail(res, "NOT_FOUND", "Method not found");
    ok(res, doc);
});
