import { Router, type IRouter } from "express";
import healthRouter from "./health";
import inventoryRouter from "./inventory";
import trimsRouter from "./trims";
import comparablesRouter from "./comparables";
import vinRouter from "./vin";
import dealIntelligenceRouter from "./deal-intelligence";
import tradeIntelligenceRouter from "./trade-intelligence";
import priceHistoryRouter from "./price-history";
import promoRouter from "./promo";
import stripeRouter from "./stripe";
import sendOfferRouter from "./send-offer";
import vehicleFeaturesRouter from "./vehicle-features";

const router: IRouter = Router();

router.use(healthRouter);
router.use(inventoryRouter);
router.use(trimsRouter);
router.use(comparablesRouter);
router.use(vinRouter);
router.use(dealIntelligenceRouter);
router.use(tradeIntelligenceRouter);
router.use(priceHistoryRouter);
router.use(promoRouter);
router.use(stripeRouter);
router.use(sendOfferRouter);
router.use(vehicleFeaturesRouter);

export default router;
