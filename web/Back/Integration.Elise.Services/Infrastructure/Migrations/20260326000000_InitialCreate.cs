/**
 * @file     20260326000000_InitialCreate.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     EF Core initial migration — creates AppUsers, Projects, ProjectFields, ProjectFieldValues
 *
 * To apply:   dotnet ef database update --project Integration.Elise.Services
 *                                        --startup-project Integration.Elise.Api.Template
 * To revert:  dotnet ef database update 0 --project Integration.Elise.Services
 *                                         --startup-project Integration.Elise.Api.Template
 */

using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Integration.Elise.Services.Infrastructure.Migrations;

/// <inheritdoc />
public partial class InitialCreate : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        // ── AppUsers ─────────────────────────────────────────────────────────
        migrationBuilder.CreateTable(
            name: "AppUsers",
            columns: table => new
            {
                Id           = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                FirstName    = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                LastName     = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                Email        = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                PasswordHash = table.Column<string>(type: "nvarchar(max)", nullable: false),
                Role         = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                IsActive            = table.Column<bool>(type: "bit", nullable: false, defaultValue: true),
                CreatedAt           = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()"),
                LastLoginAt         = table.Column<DateTime>(type: "datetime2", nullable: true),
                MustChangePassword  = table.Column<bool>(type: "bit", nullable: false, defaultValue: false),
                FailedLoginAttempts = table.Column<int>(type: "int", nullable: false, defaultValue: 0),
                LockedUntil         = table.Column<DateTime>(type: "datetime2", nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_AppUsers", x => x.Id);
            });

        migrationBuilder.CreateIndex(
            name: "IX_AppUsers_Email",
            table: "AppUsers",
            column: "Email",
            unique: true);

        // ── Projects ──────────────────────────────────────────────────────────
        migrationBuilder.CreateTable(
            name: "Projects",
            columns: table => new
            {
                Id                = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                Name              = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                ClientName        = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                StartDate         = table.Column<DateTime>(type: "datetime2", nullable: false),
                EndDate           = table.Column<DateTime>(type: "datetime2", nullable: false),
                ProjectManagerId  = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                Status            = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                CreatedByAdminId  = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                CreatedAt                  = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()"),
                UpdatedAt                  = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()"),
                AllowManagerCustomFields   = table.Column<bool>(type: "bit", nullable: false, defaultValue: false),
                AiOutput                   = table.Column<string>(type: "nvarchar(4000)", maxLength: 4000, nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_Projects", x => x.Id);
                table.ForeignKey(
                    name: "FK_Projects_AppUsers_ProjectManagerId",
                    column: x => x.ProjectManagerId,
                    principalTable: "AppUsers",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Restrict);
                table.ForeignKey(
                    name: "FK_Projects_AppUsers_CreatedByAdminId",
                    column: x => x.CreatedByAdminId,
                    principalTable: "AppUsers",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Restrict);
            });

        migrationBuilder.CreateIndex(
            name: "IX_Projects_ProjectManagerId",
            table: "Projects",
            column: "ProjectManagerId");

        migrationBuilder.CreateIndex(
            name: "IX_Projects_Status",
            table: "Projects",
            column: "Status");

        // ── ProjectFields ─────────────────────────────────────────────────────
        migrationBuilder.CreateTable(
            name: "ProjectFields",
            columns: table => new
            {
                Id            = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                ProjectId     = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                Label         = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                FieldType     = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: false),
                IsRequired    = table.Column<bool>(type: "bit", nullable: false),
                DefaultValue  = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                OrderIndex    = table.Column<int>(type: "int", nullable: false),
                FieldCategory = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: false),
                Options       = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_ProjectFields", x => x.Id);
                table.ForeignKey(
                    name: "FK_ProjectFields_Projects_ProjectId",
                    column: x => x.ProjectId,
                    principalTable: "Projects",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateIndex(
            name: "IX_ProjectFields_ProjectId",
            table: "ProjectFields",
            column: "ProjectId");

        // ── ProjectFieldValues ────────────────────────────────────────────────
        migrationBuilder.CreateTable(
            name: "ProjectFieldValues",
            columns: table => new
            {
                Id             = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                ProjectId      = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                ProjectFieldId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                Value          = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_ProjectFieldValues", x => x.Id);
                table.ForeignKey(
                    name: "FK_ProjectFieldValues_Projects_ProjectId",
                    column: x => x.ProjectId,
                    principalTable: "Projects",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
                table.ForeignKey(
                    name: "FK_ProjectFieldValues_ProjectFields_ProjectFieldId",
                    column: x => x.ProjectFieldId,
                    principalTable: "ProjectFields",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.NoAction);
            });

        migrationBuilder.CreateIndex(
            name: "IX_ProjectFieldValues_ProjectId_ProjectFieldId",
            table: "ProjectFieldValues",
            columns: ["ProjectId", "ProjectFieldId"],
            unique: true);

        // ── ProjectValidations ────────────────────────────────────────────────
        migrationBuilder.CreateTable(
            name: "ProjectValidations",
            columns: table => new
            {
                Id                = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                ProjectId         = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                ValidatedByUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                ValidatedByRole   = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                Phase             = table.Column<string>(type: "nvarchar(50)", maxLength: 50, nullable: false),
                IsApproved        = table.Column<bool>(type: "bit", nullable: false),
                Comment           = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true),
                ValidatedAt       = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()")
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_ProjectValidations", x => x.Id);
                table.ForeignKey(
                    name: "FK_ProjectValidations_Projects_ProjectId",
                    column: x => x.ProjectId,
                    principalTable: "Projects",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
                table.ForeignKey(
                    name: "FK_ProjectValidations_AppUsers_ValidatedByUserId",
                    column: x => x.ValidatedByUserId,
                    principalTable: "AppUsers",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Restrict);
            });

        migrationBuilder.CreateIndex(
            name: "IX_ProjectValidations_ProjectId_Phase",
            table: "ProjectValidations",
            columns: new[] { "ProjectId", "Phase" });

        // ── ProjectActivities ─────────────────────────────────────────────────
        migrationBuilder.CreateTable(
            name: "ProjectActivities",
            columns: table => new
            {
                Id        = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                ProjectId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                UserId    = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                Action    = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                Detail    = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                CreatedAt = table.Column<DateTime>(type: "datetime2", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_ProjectActivities", x => x.Id);
                table.ForeignKey(
                    name: "FK_ProjectActivities_Projects_ProjectId",
                    column: x => x.ProjectId,
                    principalTable: "Projects",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
                table.ForeignKey(
                    name: "FK_ProjectActivities_AppUsers_UserId",
                    column: x => x.UserId,
                    principalTable: "AppUsers",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.SetNull);
            });

        migrationBuilder.CreateIndex(
            name: "IX_ProjectActivities_ProjectId",
            table: "ProjectActivities",
            column: "ProjectId");

        // ── ProjectTemplates ──────────────────────────────────────────────────
        migrationBuilder.CreateTable(
            name: "ProjectTemplates",
            columns: table => new
            {
                Id               = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                Name             = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                Description      = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
                CreatedByAdminId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                CreatedAt        = table.Column<DateTime>(type: "datetime2", nullable: false, defaultValueSql: "GETUTCDATE()")
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_ProjectTemplates", x => x.Id);
                table.ForeignKey(
                    name: "FK_ProjectTemplates_AppUsers_CreatedByAdminId",
                    column: x => x.CreatedByAdminId,
                    principalTable: "AppUsers",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.NoAction);
            });

        // ── ProjectTemplateFields ─────────────────────────────────────────────
        migrationBuilder.CreateTable(
            name: "ProjectTemplateFields",
            columns: table => new
            {
                Id           = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                TemplateId   = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                Label        = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                Type         = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: false),
                Category     = table.Column<string>(type: "nvarchar(30)", maxLength: 30, nullable: false),
                IsRequired   = table.Column<bool>(type: "bit", nullable: false),
                DisplayOrder = table.Column<int>(type: "int", nullable: false),
                Options      = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_ProjectTemplateFields", x => x.Id);
                table.ForeignKey(
                    name: "FK_ProjectTemplateFields_ProjectTemplates_TemplateId",
                    column: x => x.TemplateId,
                    principalTable: "ProjectTemplates",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
            });

        migrationBuilder.CreateIndex(
            name: "IX_ProjectTemplateFields_TemplateId",
            table: "ProjectTemplateFields",
            column: "TemplateId");
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "ProjectTemplateFields");
        migrationBuilder.DropTable(name: "ProjectTemplates");
        migrationBuilder.DropTable(name: "ProjectActivities");
        migrationBuilder.DropTable(name: "ProjectValidations");
        migrationBuilder.DropTable(name: "ProjectFieldValues");
        migrationBuilder.DropTable(name: "ProjectFields");
        migrationBuilder.DropTable(name: "Projects");
        migrationBuilder.DropTable(name: "AppUsers");
    }
}
