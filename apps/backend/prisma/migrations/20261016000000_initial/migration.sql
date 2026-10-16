CREATE TABLE "Collection" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SavedRequest" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "queryParams" JSONB NOT NULL,
    "headers" JSONB NOT NULL,
    "body" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SavedRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Collection_createdAt_idx" ON "Collection"("createdAt");
CREATE INDEX "SavedRequest_collectionId_idx" ON "SavedRequest"("collectionId");
ALTER TABLE "SavedRequest" ADD CONSTRAINT "SavedRequest_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
