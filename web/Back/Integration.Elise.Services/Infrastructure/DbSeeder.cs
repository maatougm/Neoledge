/**
 * @file     DbSeeder.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     Seeds test users, projects, templates, and activity data on first run
 */

using Integration.Elise.Services.Models.Domain;
using Integration.Elise.Services.Models.Enums;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Serilog;

namespace Integration.Elise.Services.Infrastructure;

/// <summary>
/// One-time database seeder.  Called from Program.cs at startup.
/// Only inserts rows when <c>AppUsers</c> is empty — safe to run on every restart.
/// </summary>
public static class DbSeeder
{
    /// <summary>
    /// Test credentials seeded for local development:
    /// <list type="bullet">
    ///   <item>admin@neoleadge.com / Admin@123   — role Admin</item>
    ///   <item>pm@neoleadge.com   / Pm@123       — role ProjectManager</item>
    ///   <item>pm2@neoleadge.com  / Pm2@123      — role ProjectManager</item>
    ///   <item>valid@neoleadge.com / Valid@123   — role DeploymentTeam</item>
    /// </list>
    /// </summary>
    public static async Task SeedAsync(IServiceProvider services)
    {
        await using var scope = services.CreateAsyncScope();
        var db     = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var logger = Log.ForContext(typeof(DbSeeder));

        try
        {
            logger.Information("DbSeeder — applying migrations...");
            await db.Database.MigrateAsync();

            if (await db.AppUsers.AnyAsync())
            {
                logger.Information("DbSeeder — table already has users, skipping seed");
                return;
            }

            // ── 1. Seed Users ────────────────────────────────────────────────────
            var adminUser = new AppUser
            {
                FirstName    = "Admin",
                LastName     = "NeoLeadge",
                Email        = "admin@neoleadge.com",
                PasswordHash = BCrypt.Net.BCrypt.HashPassword("Admin@123"),
                Role         = UserRole.Admin,
                IsActive     = true,
                JobTitle     = "System Administrator",
                Department   = "IT Operations",
                PhoneNumber  = "+33 1 23 45 67 89"
            };

            var pmUser = new AppUser
            {
                FirstName    = "Chef",
                LastName     = "DeProjet",
                Email        = "pm@neoleadge.com",
                PasswordHash = BCrypt.Net.BCrypt.HashPassword("Pm@123"),
                Role         = UserRole.ProjectManager,
                IsActive     = true,
                JobTitle     = "Senior Project Manager",
                Department   = "Consulting",
                PhoneNumber  = "+33 6 12 34 56 78"
            };

            var pmUser2 = new AppUser
            {
                FirstName    = "Marie",
                LastName     = "Dupont",
                Email        = "pm2@neoleadge.com",
                PasswordHash = BCrypt.Net.BCrypt.HashPassword("Pm2@123"),
                Role         = UserRole.ProjectManager,
                IsActive     = true,
                JobTitle     = "Project Manager",
                Department   = "Consulting"
            };

            var validUser = new AppUser
            {
                FirstName    = "Equipe",
                LastName     = "Validation",
                Email        = "valid@neoleadge.com",
                PasswordHash = BCrypt.Net.BCrypt.HashPassword("Valid@123"),
                Role         = UserRole.DeploymentTeam,
                IsActive     = true
            };

            var newUser = new AppUser
            {
                FirstName          = "Nouvel",
                LastName           = "Utilisateur",
                Email              = "newuser@neoleadge.com",
                PasswordHash       = BCrypt.Net.BCrypt.HashPassword("Temp@123"),
                Role               = UserRole.Viewer,
                IsActive           = true,
                MustChangePassword = true
            };

            db.AppUsers.AddRange(adminUser, pmUser, pmUser2, validUser, newUser);
            await db.SaveChangesAsync();
            logger.Information("DbSeeder — seeded 5 test users");

            // ── 2. Seed Project Templates ────────────────────────────────────────
            var template1 = new ProjectTemplate
            {
                Name = "Déploiement Standard Elise",
                Description = "Template standard pour les déploiements Elise avec toutes les étapes classiques",
                CreatedByAdminId = adminUser.Id
            };

            var template2 = new ProjectTemplate
            {
                Name = "Migration Legacy",
                Description = "Template pour migration depuis un système legacy vers Elise",
                CreatedByAdminId = adminUser.Id
            };

            db.ProjectTemplates.AddRange(template1, template2);
            await db.SaveChangesAsync();
            logger.Information("DbSeeder — seeded 2 project templates");

            // ── 3. Seed Template Fields ──────────────────────────────────────────
            var templateFields = new List<ProjectTemplateField>
            {
                new() { TemplateId = template1.Id, Label = "Version Elise", Type = FieldType.Text, Category = FieldCategory.Custom, DisplayOrder = 0 },
                new() { TemplateId = template1.Id, Label = "Base de données existante", Type = FieldType.Select, Category = FieldCategory.Custom, Options = "[\"SQL Server\",\"Oracle\",\"PostgreSQL\",\"Aucune\"]", DisplayOrder = 1 },
                new() { TemplateId = template1.Id, Label = "Nombre d'utilisateurs prévus", Type = FieldType.Number, Category = FieldCategory.Custom, DisplayOrder = 2 },
                new() { TemplateId = template2.Id, Label = "Système source", Type = FieldType.Text, Category = FieldCategory.Custom, DisplayOrder = 0 },
                new() { TemplateId = template2.Id, Label = "Volume de données à migrer (Go)", Type = FieldType.Number, Category = FieldCategory.Custom, DisplayOrder = 1 }
            };

            db.ProjectTemplateFields.AddRange(templateFields);
            await db.SaveChangesAsync();
            logger.Information("DbSeeder — seeded {Count} template fields", templateFields.Count);

            // ── 4. Seed Projects ─────────────────────────────────────────────────
            var project1 = new Project
            {
                Name = "Déploiement GED Ministère",
                ClientName = "Ministère de l'Éducation Nationale",
                StartDate = DateTime.UtcNow.AddDays(14),
                EndDate = DateTime.UtcNow.AddDays(90),
                Status = ProjectStatus.InProgress,
                ProjectManagerId = pmUser.Id,
                CreatedByAdminId = adminUser.Id,
                AllowManagerCustomFields = true,
                Budget = 450000.00m,
                Priority = ProjectPriority.High,
                Tags = "GED,Public,HauteDispo",
                AiOutput = "Analyse préliminaire: projet complexe nécessitant une architecture haute disponibilité. Recommandation: déploiement en cluster avec réplication de base de données."
            };

            var project2 = new Project
            {
                Name = "Migration Documentum vers Elise",
                ClientName = "Groupe Hospitalier Sud",
                StartDate = DateTime.UtcNow.AddDays(-30),
                EndDate = DateTime.UtcNow.AddDays(60),
                Status = ProjectStatus.SpecificationValidation,
                ProjectManagerId = pmUser.Id,
                CreatedByAdminId = adminUser.Id,
                AllowManagerCustomFields = false,
                Budget = 120000.00m,
                Priority = ProjectPriority.High,
                Tags = "Migration,Sante"
            };

            var project3 = new Project
            {
                Name = "Implémentation BPM - Société Financière",
                ClientName = "Société Financière Alpha",
                StartDate = DateTime.UtcNow.AddDays(7),
                EndDate = DateTime.UtcNow.AddDays(45),
                Status = ProjectStatus.Draft,
                ProjectManagerId = pmUser2.Id,
                CreatedByAdminId = adminUser.Id,
                AllowManagerCustomFields = true,
                Budget = 85000.00m,
                Priority = ProjectPriority.Medium,
                Tags = "BPM,Finance"
            };

            var project4 = new Project
            {
                Name = "Déploiement Multi-Sites Industrie",
                ClientName = "Groupe Industriel MétalPro",
                StartDate = DateTime.UtcNow.AddDays(-60),
                EndDate = DateTime.UtcNow.AddDays(30),
                Status = ProjectStatus.Realization,
                ProjectManagerId = pmUser2.Id,
                CreatedByAdminId = adminUser.Id,
                AllowManagerCustomFields = true,
                AiOutput = "Projet en bonne voie. 3 sites sur 5 déjà déployés. Attention requise sur la synchronisation inter-sites."
            };

            var project5 = new Project
            {
                Name = "Archivage Électronique Légale",
                ClientName = "Caisse des Dépôts",
                StartDate = DateTime.UtcNow.AddDays(-90),
                EndDate = DateTime.UtcNow.AddDays(-10),
                Status = ProjectStatus.Completed,
                ProjectManagerId = pmUser.Id,
                CreatedByAdminId = adminUser.Id,
                AllowManagerCustomFields = false
            };

            db.Projects.AddRange(project1, project2, project3, project4, project5);
            await db.SaveChangesAsync();
            logger.Information("DbSeeder — seeded 5 projects");

            // ── 5. Seed Project Fields ───────────────────────────────────────────
            var projectFields = new List<ProjectField>
            {
                new() { ProjectId = project1.Id, Label = "Version Elise", FieldType = FieldType.Text, FieldCategory = FieldCategory.Static, IsRequired = true, OrderIndex = 0, DefaultValue = "6.5" },
                new() { ProjectId = project1.Id, Label = "Base de données existante", FieldType = FieldType.Select, FieldCategory = FieldCategory.Static, IsRequired = true, OrderIndex = 1, Options = "[\"SQL Server\",\"Oracle\",\"PostgreSQL\",\"Aucune\"]", DefaultValue = "SQL Server" },
                new() { ProjectId = project1.Id, Label = "Nombre d'utilisateurs prévus", FieldType = FieldType.Number, FieldCategory = FieldCategory.Static, IsRequired = true, OrderIndex = 2, DefaultValue = "500" },
                new() { ProjectId = project1.Id, Label = "Intégration SSO requise", FieldType = FieldType.Checkbox, FieldCategory = FieldCategory.Static, IsRequired = false, OrderIndex = 3, DefaultValue = "true" },
                new() { ProjectId = project1.Id, Label = "Commentaires additionnels", FieldType = FieldType.Text, FieldCategory = FieldCategory.Dynamic, IsRequired = false, OrderIndex = 4 },
                
                new() { ProjectId = project2.Id, Label = "Système source", FieldType = FieldType.Text, FieldCategory = FieldCategory.Static, IsRequired = true, OrderIndex = 0, DefaultValue = "Documentum 7.3" },
                new() { ProjectId = project2.Id, Label = "Volume de données", FieldType = FieldType.Number, FieldCategory = FieldCategory.Static, IsRequired = true, OrderIndex = 1, DefaultValue = "2500" },
                new() { ProjectId = project2.Id, Label = "Délai critique", FieldType = FieldType.Checkbox, FieldCategory = FieldCategory.Dynamic, IsRequired = false, OrderIndex = 2, DefaultValue = "true" }
            };

            db.ProjectFields.AddRange(projectFields);
            await db.SaveChangesAsync();
            logger.Information("DbSeeder — seeded {Count} project fields", projectFields.Count);

            // ── 6. Seed Project Activities ───────────────────────────────────────
            var activities = new List<ProjectActivity>
            {
                new() { ProjectId = project1.Id, UserId = adminUser.Id, Action = "ProjectCreated", Detail = "Projet créé par Admin" },
                new() { ProjectId = project1.Id, UserId = adminUser.Id, Action = "ManagerAssigned", Detail = "Chef DeProjet assigné comme PM" },
                new() { ProjectId = project1.Id, UserId = pmUser.Id, Action = "StatusChanged", Detail = "Draft → InProgress" },
                new() { ProjectId = project1.Id, UserId = pmUser.Id, Action = "FieldAdded", Detail = "Champ 'Commentaires additionnels' ajouté" },
                new() { ProjectId = project2.Id, UserId = adminUser.Id, Action = "ProjectCreated", Detail = "Projet créé par Admin" },
                new() { ProjectId = project2.Id, UserId = pmUser.Id, Action = "StatusChanged", Detail = "Draft → InProgress → SpecificationValidation" },
                new() { ProjectId = project5.Id, UserId = adminUser.Id, Action = "ProjectCreated", Detail = "Projet créé par Admin" },
                new() { ProjectId = project5.Id, UserId = pmUser.Id, Action = "StatusChanged", Detail = "Draft → InProgress → Realization → DeploymentValidation → Completed" },
                new() { ProjectId = project5.Id, UserId = validUser.Id, Action = "ProjectValidated", Detail = "Validation finale par l'équipe de déploiement" }
            };

            db.ProjectActivities.AddRange(activities);
            await db.SaveChangesAsync();
            logger.Information("DbSeeder — seeded {Count} activities", activities.Count);

            logger.Information("DbSeeder — completed successfully");
        }
        catch (Exception ex)
        {
            logger.Error(ex, "DbSeeder — failed to seed database");
            throw;
        }
    }
}
