import { PrismaClient } from "@prisma/client";
import { createApp } from "./app";

export const prisma = new PrismaClient();
export const app = createApp(prisma);
