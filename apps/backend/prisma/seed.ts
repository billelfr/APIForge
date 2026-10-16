import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const existing = await prisma.collection.findFirst({ where: { name: "Example" } });
  if (existing) return;

  await prisma.collection.create({
    data: {
      name: "Example",
      requests: {
        create: {
          name: "Public JSON placeholder",
          method: "GET",
          url: "https://jsonplaceholder.typicode.com/todos/1",
          queryParams: {},
          headers: {},
        },
      },
    },
  });
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch((error: unknown) => {
    console.error("Database seed failed", error);
    process.exitCode = 1;
  });
