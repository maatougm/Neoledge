/**
 * @file     20260327000000_AddProfileFieldsAndNewTables.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-27
 * @desc     EF Core migration — adds profile fields to AppUsers, soft-delete/priority/tags to Projects,
 *           and creates ProjectComments and ProjectAttachments tables.
 *
 * To apply:   dotnet ef database update --project Integration.Elise.Services
 *                                        --startup-project Integration.Elise.Api.Template
 * To revert:  dotnet ef database update InitialCreate --project Integration.Elise.Services
 *                                                     --startup-project Integration.Elise.Api.Template
 */

using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Integration.Elise.Services.Infrastructure.Migrations;

/// <inheritdoc />
public partial class AddProfileFieldsAndNewTables : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        // ── AppUsers: add profile fields ──────────────────────────────────────
        migrationBuilder.AddColumn<string>(
            name: "AvatarPath",
            table: "AppUsers",
            type: "nvarchar(500)",
            maxLength: 500,
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "JobTitle",
            table: "AppUsers",
            type: "nvarchar(100)",
            maxLength: 100,
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "PhoneNumber",
            table: "AppUsers",
            type: "nvarchar(50)",
            maxLength: 50,
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "Department",
            table: "AppUsers",
            type: "nvarchar(100)",
            maxLength: 100,
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "Preferences",
            table: "AppUsers",
            type: "nvarchar(max)",
            nullable: true);

        // ── Projects: add soft-delete, priority, tags, budget ─────────────────
        migrationBuilder.AddColumn<bool>(
            name: "IsDeleted",
            table: "Projects",
            type: "bit",
            nullable: false,
            defaultValue: false);

        migrationBuilder.AddColumn<DateTime>(
            name: "DeletedAt",
            table: "Projects",
            type: "datetime2",
            nullable: true);

        migrationBuilder.AddColumn<Guid>(
            name: "DeletedByUserId",
            table: "Projects",
            type: "uniqueidentifier",
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "Priority",
            table: "Projects",
            type: "nvarchar(20)",
            maxLength: 20,
            nullable: false,
            defaultValue: "Medium");

        migrationBuilder.AddColumn<string>(
            name: "Tags",
            table: "Projects",
            type: "nvarchar(500)",
            maxLength: 500,
            nullable: true);

        migrationBuilder.AddColumn<decimal>(
            name: "Budget",
            table: "Projects",
            type: "decimal(18,2)",
            nullable: true);

        // FK: Projects.DeletedByUserId → AppUsers.Id
        migrationBuilder.AddForeignKey(
            name: "FK_Projects_AppUsers_DeletedByUserId",
            table: "Projects",
            column: "DeletedByUserId",
            principalTable: "AppUsers",
            principalColumn: "Id",
            onDelete: ReferentialAction.SetNull);

        migrationBuilder.CreateIndex(
            name: "IX_Projects_IsDeleted",
            table: "Projects",
            column: "IsDeleted");

        migrationBuilder.CreateIndex(
            name: "IX_Projects_Priority",
            table: "Projects",
            column: "Priority");

        migrationBuilder.CreateIndex(
            name: "IX_Projects_IsDeleted_Status",
            table: "Projects",
            columns: new[] { "IsDeleted", "Status" });

        // ── ProjectComments ───────────────────────────────────────────────────
        migrationBuilder.CreateTable(
            name: "ProjectComments",
            columns: table => new
            {
                Id              = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                ProjectId       = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                UserId          = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                Content         = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                CreatedAt       = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()"),
                UpdatedAt       = table.Column<DateTime>(type: "datetime2", nullable: true),
                IsDeleted       = table.Column<bool>(type: "bit", nullable: false, defaultValue: false),
                ParentCommentId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                Mentions        = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_ProjectComments", x => x.Id);
                table.ForeignKey(
                    name: "FK_ProjectComments_Projects_ProjectId",
                    column: x => x.ProjectId,
                    principalTable: "Projects",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
                table.ForeignKey(
                    name: "FK_ProjectComments_AppUsers_UserId",
                    column: x => x.UserId,
                    principalTable: "AppUsers",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Restrict);
                table.ForeignKey(
                    name: "FK_ProjectComments_ProjectComments_ParentCommentId",
                    column: x => x.ParentCommentId,
                    principalTable: "ProjectComments",
                    principalColumn: "Id");
            });

        migrationBuilder.CreateIndex(
            name: "IX_ProjectComments_ProjectId",
            table: "ProjectComments",
            column: "ProjectId");

        migrationBuilder.CreateIndex(
            name: "IX_ProjectComments_UserId",
            table: "ProjectComments",
            column: "UserId");

        migrationBuilder.CreateIndex(
            name: "IX_ProjectComments_CreatedAt",
            table: "ProjectComments",
            column: "CreatedAt");

        // ── ProjectAttachments ────────────────────────────────────────────────
        migrationBuilder.CreateTable(
            name: "ProjectAttachments",
            columns: table => new
            {
                Id                = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                ProjectId         = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                UploadedByUserId  = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                FileName          = table.Column<string>(type: "nvarchar(255)", maxLength: 255, nullable: false),
                FileExtension     = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                ContentType       = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                FileSize          = table.Column<long>(type: "bigint", nullable: false),
                StoragePath       = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                Description       = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                Category          = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: false, defaultValue: "Document"),
                UploadedAt        = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()"),
                IsDeleted         = table.Column<bool>(type: "bit", nullable: false, defaultValue: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_ProjectAttachments", x => x.Id);
                table.ForeignKey(
                    name: "FK_ProjectAttachments_Projects_ProjectId",
                    column: x => x.ProjectId,
                    principalTable: "Projects",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
                table.ForeignKey(
                    name: "FK_ProjectAttachments_AppUsers_UploadedByUserId",
                    column: x => x.UploadedByUserId,
                    principalTable: "AppUsers",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Restrict);
            });

        migrationBuilder.CreateIndex(
            name: "IX_ProjectAttachments_ProjectId",
            table: "ProjectAttachments",
            column: "ProjectId");

        migrationBuilder.CreateIndex(
            name: "IX_ProjectAttachments_UploadedByUserId",
            table: "ProjectAttachments",
            column: "UploadedByUserId");

        migrationBuilder.CreateIndex(
            name: "IX_ProjectAttachments_UploadedAt",
            table: "ProjectAttachments",
            column: "UploadedAt");

        migrationBuilder.CreateIndex(
            name: "IX_ProjectAttachments_Category",
            table: "ProjectAttachments",
            column: "Category");
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "ProjectAttachments");
        migrationBuilder.DropTable(name: "ProjectComments");

        migrationBuilder.DropForeignKey(
            name: "FK_Projects_AppUsers_DeletedByUserId",
            table: "Projects");

        migrationBuilder.DropIndex(name: "IX_Projects_IsDeleted",        table: "Projects");
        migrationBuilder.DropIndex(name: "IX_Projects_Priority",         table: "Projects");
        migrationBuilder.DropIndex(name: "IX_Projects_IsDeleted_Status", table: "Projects");

        migrationBuilder.DropColumn(name: "IsDeleted",       table: "Projects");
        migrationBuilder.DropColumn(name: "DeletedAt",       table: "Projects");
        migrationBuilder.DropColumn(name: "DeletedByUserId", table: "Projects");
        migrationBuilder.DropColumn(name: "Priority",        table: "Projects");
        migrationBuilder.DropColumn(name: "Tags",            table: "Projects");
        migrationBuilder.DropColumn(name: "Budget",          table: "Projects");

        migrationBuilder.DropColumn(name: "AvatarPath",   table: "AppUsers");
        migrationBuilder.DropColumn(name: "JobTitle",     table: "AppUsers");
        migrationBuilder.DropColumn(name: "PhoneNumber",  table: "AppUsers");
        migrationBuilder.DropColumn(name: "Department",   table: "AppUsers");
        migrationBuilder.DropColumn(name: "Preferences",  table: "AppUsers");
    }
}
