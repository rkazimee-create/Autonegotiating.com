import { Router, type IRouter } from "express";
import healthRouter from "./health";
import inventoryRouter from "./inventory";
import trimsRouter from "./trims";
import comparablesRouter from "./comparables";
import vinRouter from "./vin";
import dealIntelligenceRouter from "./deal-intelligence";
import priceHistoryRouter from "./price-history";
import promoRouter from "./promo";
import stripeRouter from "./stripe";

const router: IRouter = Router();

router.use(healthRouter);
router.use(inventoryRouter);
router.use(trimsRouter);
router.use(comparablesRouter);
router.use(vinRouter);
router.use(dealIntelligenceRouter);
router.use(priceHistoryRouter);
router.use(promoRouter);
router.use(stripeRouter);

export default router;
