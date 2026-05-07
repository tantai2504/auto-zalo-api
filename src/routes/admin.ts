import { Router } from "express";
import { z } from "zod";
import { loginAdmin, logoutAdmin, meAdmin } from "../http/admin.js";
import { failValidation } from "../http/response.js";

export const adminRouter: Router = Router();

const LoginBody = z.object({
    username: z.string().min(1),
    password: z.string().min(1),
});

adminRouter.post("/login", (req, res) => {
    const body = LoginBody.safeParse(req.body ?? {});
    if (!body.success) return failValidation(res, body.error);
    loginAdmin(req, res, body.data);
});

adminRouter.post("/logout", (_req, res) => logoutAdmin(_req, res));

adminRouter.get("/me", (req, res) => meAdmin(req, res));
