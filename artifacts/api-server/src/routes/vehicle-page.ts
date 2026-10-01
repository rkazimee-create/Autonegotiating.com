import { Router, type IRouter } from "express";
import { createPersistedVehiclePageHandler } from "../lib/persisted-vehicle-page";

const router: IRouter = Router();

router.get("/vehicle/:vin", createPersistedVehiclePageHandler());

export default router;