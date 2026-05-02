-- CreateTable
CREATE TABLE "ProjectMembers" (
    "id" TEXT NOT NULL,
    "projectId" VARCHAR(36) NOT NULL,
    "userId" VARCHAR(36) NOT NULL,
    "label" VARCHAR(150) NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMembers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectMembers_projectId_idx" ON "ProjectMembers"("projectId");

-- CreateIndex
CREATE INDEX "ProjectMembers_userId_idx" ON "ProjectMembers"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMembers_projectId_userId_key" ON "ProjectMembers"("projectId", "userId");

-- AddForeignKey
ALTER TABLE "ProjectMembers" ADD CONSTRAINT "ProjectMembers_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMembers" ADD CONSTRAINT "ProjectMembers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AppUsers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
