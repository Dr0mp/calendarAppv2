import { z } from "zod";
import { id, optText, ownerColor, text } from "./common.js";

const capacity = (max) =>
  z.number().int("invalid_type").min(0, "too_small").max(max, "too_big");

export const SpaceInput = z.strictObject({
  name: text(80),
  capacity_people: capacity(10000).nullable(),
  color: ownerColor,
  description: optText(1000),
  enabled: z.boolean(),
});

export const RoomInput = z.strictObject({
  name: text(80),
  room_type: optText(40),
  capacity_guests: z
    .number()
    .int("invalid_type")
    .min(1, "too_small")
    .max(50, "too_big"),
  beds: optText(120),
  color: ownerColor,
  notes: optText(1000),
  enabled: z.boolean(),
});

export const Reorder = z.strictObject({ ids: z.array(id).min(1).max(500) });

export { ROOM_TYPES } from "../rules/validate.js";
