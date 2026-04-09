/**
 * @file     ApplicationDbContext.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     EF Core DbContext — all DbSets, model configuration, enum conversions
 */

using Integration.Elise.Services.Models.Domain;
using Integration.Elise.Services.Models.Enums;
using Microsoft.EntityFrameworkCore;

namespace Integration.Elise.Services.Infrastructure;

/// <summary>
/// Entity Framework Core database context for the NeoLeadge deployment management module.
/// Configures all entities, indexes, cascade rules and enum-to-string value conversions.
/// </summary>
public class ApplicationDbContext : DbContext
{
    public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options)
        : base(options)
    {
    }

    /// <summary>Application users.</summary>
    public DbSet<AppUser> AppUsers => Set<AppUser>();

    /// <summary>Deployment projects.</summary>
    public DbSet<Project> Projects => Set<Project>();

    /// <summary>Project field definitions (schema).</summary>
    public DbSet<ProjectField> ProjectFields => Set<ProjectField>();

    /// <summary>Project field runtime values.</summary>
    public DbSet<ProjectFieldValue> ProjectFieldValues => Set<ProjectFieldValue>();

    /// <summary>Team validation records for project lifecycle phases.</summary>
    public DbSet<ProjectValidation> ProjectValidations => Set<ProjectValidation>();

    /// <summary>Per-project activity feed entries.</summary>
    public DbSet<ProjectActivity> ProjectActivities => Set<ProjectActivity>();

    /// <summary>Reusable project templates defined by admins.</summary>
    public DbSet<ProjectTemplate> ProjectTemplates => Set<ProjectTemplate>();

    /// <summary>Field definitions belonging to a project template.</summary>
    public DbSet<ProjectTemplateField> ProjectTemplateFields => Set<ProjectTemplateField>();

    /// <summary>Project comments for team discussion.</summary>
    public DbSet<ProjectComment> ProjectComments => Set<ProjectComment>();

    /// <summary>Project file attachments.</summary>
    public DbSet<ProjectAttachment> ProjectAttachments => Set<ProjectAttachment>();

    /// <summary>Meeting audio transcripts.</summary>
    public DbSet<MeetingTranscript> MeetingTranscripts => Set<MeetingTranscript>();

    /// <summary>Individual transcript segments.</summary>
    public DbSet<TranscriptSegment> TranscriptSegments => Set<TranscriptSegment>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // ── AppUser ──────────────────────────────────────────────────────────
        modelBuilder.Entity<AppUser>(entity =>
        {
            entity.ToTable("AppUsers");
            entity.HasKey(u => u.Id);
            entity.Property(u => u.FirstName).IsRequired().HasMaxLength(100);
            entity.Property(u => u.LastName).IsRequired().HasMaxLength(100);
            entity.Property(u => u.Email).IsRequired().HasMaxLength(256);
            entity.Property(u => u.PasswordHash).IsRequired();
            entity.Property(u => u.Role)
                  .HasConversion<string>()
                  .HasMaxLength(50);
            entity.Property(u => u.IsActive).HasDefaultValue(true);
            entity.Property(u => u.CreatedAt).HasDefaultValueSql("GETUTCDATE()");
            entity.Property(u => u.AvatarPath).HasMaxLength(500);
            entity.Property(u => u.JobTitle).HasMaxLength(100);
            entity.Property(u => u.PhoneNumber).HasMaxLength(50);
            entity.Property(u => u.Department).HasMaxLength(100);

            entity.HasIndex(u => u.Email).IsUnique();
            entity.HasIndex(u => u.IsActive);
        });

        // ── Project ───────────────────────────────────────────────────────────
        modelBuilder.Entity<Project>(entity =>
        {
            entity.ToTable("Projects");
            entity.HasKey(p => p.Id);
            entity.Property(p => p.Name).IsRequired().HasMaxLength(200);
            entity.Property(p => p.ClientName).IsRequired().HasMaxLength(200);
            entity.Property(p => p.Status)
                  .HasConversion<string>()
                  .HasMaxLength(50);
            entity.Property(p => p.Priority)
                  .HasConversion<string>()
                  .HasMaxLength(20);
            entity.Property(p => p.CreatedAt).HasDefaultValueSql("GETUTCDATE()");
            entity.Property(p => p.UpdatedAt).HasDefaultValueSql("GETUTCDATE()");
            entity.Property(p => p.AllowManagerCustomFields).HasDefaultValue(false);
            entity.Property(p => p.AiOutput).HasMaxLength(4000);
            entity.Property(p => p.Tags).HasMaxLength(500);
            entity.Property(p => p.IsDeleted).HasDefaultValue(false);

            entity.HasIndex(p => p.Status);
            entity.HasIndex(p => p.ProjectManagerId);
            entity.HasIndex(p => p.IsDeleted);
            entity.HasIndex(p => p.Priority);
            entity.HasIndex(p => p.CreatedAt);
            entity.HasIndex(p => new { p.IsDeleted, p.Status });

            // ProjectManager → restrict (do not cascade delete when PM is deleted)
            entity.HasOne(p => p.ProjectManager)
                  .WithMany(u => u.ManagedProjects)
                  .HasForeignKey(p => p.ProjectManagerId)
                  .OnDelete(DeleteBehavior.Restrict)
                  .IsRequired(false);

            // CreatedByAdmin → no cascade
            entity.HasOne(p => p.CreatedByAdmin)
                  .WithMany()
                  .HasForeignKey(p => p.CreatedByAdminId)
                  .OnDelete(DeleteBehavior.Restrict);

            // DeletedByUser → no cascade
            entity.HasOne(p => p.DeletedByUser)
                  .WithMany()
                  .HasForeignKey(p => p.DeletedByUserId)
                  .OnDelete(DeleteBehavior.SetNull)
                  .IsRequired(false);

            // Global query filter for soft delete
            entity.HasQueryFilter(p => !p.IsDeleted);
        });

        // ── ProjectField ──────────────────────────────────────────────────────
        modelBuilder.Entity<ProjectField>(entity =>
        {
            entity.ToTable("ProjectFields");
            entity.HasKey(f => f.Id);
            entity.Property(f => f.Label).IsRequired().HasMaxLength(200);
            entity.Property(f => f.FieldType)
                  .HasConversion<string>()
                  .HasMaxLength(30);
            entity.Property(f => f.FieldCategory)
                  .HasConversion<string>()
                  .HasMaxLength(30);
            entity.Property(f => f.Options).HasMaxLength(2000);
            entity.Property(f => f.DefaultValue).HasMaxLength(500);

            entity.HasOne(f => f.Project)
                  .WithMany(p => p.Fields)
                  .HasForeignKey(f => f.ProjectId)
                  .OnDelete(DeleteBehavior.Cascade);
        });

        // ── ProjectFieldValue ─────────────────────────────────────────────────
        modelBuilder.Entity<ProjectFieldValue>(entity =>
        {
            entity.ToTable("ProjectFieldValues");
            entity.HasKey(v => v.Id);
            entity.Property(v => v.Value).HasMaxLength(2000);

            entity.HasOne(v => v.Project)
                  .WithMany(p => p.FieldValues)
                  .HasForeignKey(v => v.ProjectId)
                  .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(v => v.ProjectField)
                  .WithMany(f => f.Values)
                  .HasForeignKey(v => v.ProjectFieldId)
                  .OnDelete(DeleteBehavior.NoAction);

            entity.HasIndex(v => new { v.ProjectId, v.ProjectFieldId }).IsUnique();
        });

        // ── ProjectValidation ─────────────────────────────────────────────────
        modelBuilder.Entity<ProjectValidation>(entity =>
        {
            entity.ToTable("ProjectValidations");
            entity.HasKey(v => v.Id);
            entity.Property(v => v.ValidatedByRole).IsRequired().HasMaxLength(50);
            entity.Property(v => v.Phase).HasConversion<string>().HasMaxLength(50);
            entity.Property(v => v.Comment).HasMaxLength(2000);
            entity.Property(v => v.ValidatedAt).HasDefaultValueSql("GETUTCDATE()");
            entity.HasOne(v => v.Project).WithMany().HasForeignKey(v => v.ProjectId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(v => v.ValidatedBy).WithMany().HasForeignKey(v => v.ValidatedByUserId).OnDelete(DeleteBehavior.Restrict);
            entity.HasIndex(v => new { v.ProjectId, v.Phase });
        });

        // ── ProjectActivity ───────────────────────────────────────────────────
        modelBuilder.Entity<ProjectActivity>(e =>
        {
            e.ToTable("ProjectActivities");
            e.HasKey(a => a.Id);
            e.Property(a => a.Action).HasMaxLength(100).IsRequired();
            e.Property(a => a.Detail).HasMaxLength(500);
            e.HasOne(a => a.Project)
             .WithMany()
             .HasForeignKey(a => a.ProjectId)
             .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(a => a.User)
             .WithMany()
             .HasForeignKey(a => a.UserId)
             .OnDelete(DeleteBehavior.SetNull);
            e.HasIndex(a => a.ProjectId);
            e.HasIndex(a => a.CreatedAt);
        });

        // ── ProjectTemplate ───────────────────────────────────────────────────
        modelBuilder.Entity<ProjectTemplate>(e =>
        {
            e.ToTable("ProjectTemplates");
            e.HasKey(t => t.Id);
            e.Property(t => t.Name).IsRequired().HasMaxLength(200);
            e.Property(t => t.Description).HasMaxLength(1000);
            e.Property(t => t.CreatedAt).HasDefaultValueSql("GETUTCDATE()");
            e.HasOne(t => t.CreatedByAdmin)
             .WithMany()
             .HasForeignKey(t => t.CreatedByAdminId)
             .OnDelete(DeleteBehavior.NoAction);
        });

        // ── ProjectTemplateField ──────────────────────────────────────────────
        modelBuilder.Entity<ProjectTemplateField>(e =>
        {
            e.ToTable("ProjectTemplateFields");
            e.HasKey(f => f.Id);
            e.Property(f => f.Label).IsRequired().HasMaxLength(200);
            e.Property(f => f.Type).HasConversion<string>().HasMaxLength(30);
            e.Property(f => f.Category).HasConversion<string>().HasMaxLength(30);
            e.Property(f => f.Options).HasMaxLength(2000);
            e.HasOne(f => f.Template)
             .WithMany(t => t.Fields)
             .HasForeignKey(f => f.TemplateId)
             .OnDelete(DeleteBehavior.Cascade);
        });

        // ── ProjectComment ────────────────────────────────────────────────────
        modelBuilder.Entity<ProjectComment>(e =>
        {
            e.ToTable("ProjectComments");
            e.HasKey(c => c.Id);
            e.Property(c => c.Content).IsRequired().HasMaxLength(2000);
            e.Property(c => c.CreatedAt).HasDefaultValueSql("GETUTCDATE()");
            e.Property(c => c.Mentions).HasMaxLength(500);
            e.Property(c => c.IsDeleted).HasDefaultValue(false);

            e.HasOne(c => c.Project)
             .WithMany(p => p.Comments)
             .HasForeignKey(c => c.ProjectId)
             .OnDelete(DeleteBehavior.Cascade);

            e.HasOne(c => c.User)
             .WithMany(u => u.Comments)
             .HasForeignKey(c => c.UserId)
             .OnDelete(DeleteBehavior.Restrict);

            e.HasOne(c => c.ParentComment)
             .WithMany(c => c.Replies)
             .HasForeignKey(c => c.ParentCommentId)
             .OnDelete(DeleteBehavior.NoAction);

            e.HasIndex(c => c.ProjectId);
            e.HasIndex(c => c.UserId);
            e.HasIndex(c => c.CreatedAt);

            // Global query filter for soft delete
            e.HasQueryFilter(c => !c.IsDeleted);
        });

        // ── ProjectAttachment ─────────────────────────────────────────────────
        modelBuilder.Entity<ProjectAttachment>(e =>
        {
            e.ToTable("ProjectAttachments");
            e.HasKey(a => a.Id);
            e.Property(a => a.FileName).IsRequired().HasMaxLength(255);
            e.Property(a => a.FileExtension).IsRequired().HasMaxLength(20);
            e.Property(a => a.ContentType).IsRequired().HasMaxLength(100);
            e.Property(a => a.StoragePath).IsRequired().HasMaxLength(500);
            e.Property(a => a.Description).HasMaxLength(500);
            e.Property(a => a.Category).HasConversion<string>().HasMaxLength(30);
            e.Property(a => a.UploadedAt).HasDefaultValueSql("GETUTCDATE()");
            e.Property(a => a.IsDeleted).HasDefaultValue(false);

            e.HasOne(a => a.Project)
             .WithMany(p => p.Attachments)
             .HasForeignKey(a => a.ProjectId)
             .OnDelete(DeleteBehavior.Cascade);

            e.HasOne(a => a.UploadedBy)
             .WithMany(u => u.Attachments)
             .HasForeignKey(a => a.UploadedByUserId)
             .OnDelete(DeleteBehavior.Restrict);

            e.HasIndex(a => a.ProjectId);
            e.HasIndex(a => a.UploadedByUserId);
            e.HasIndex(a => a.UploadedAt);
            e.HasIndex(a => a.Category);

            // Global query filter for soft delete
            e.HasQueryFilter(a => !a.IsDeleted);
        });

        // ── MeetingTranscript ─────────────────────────────────────────────────
        modelBuilder.Entity<MeetingTranscript>(e =>
        {
            e.ToTable("MeetingTranscripts");
            e.HasKey(t => t.Id);
            e.Property(t => t.Title).IsRequired().HasMaxLength(200);
            e.Property(t => t.OriginalFileName).HasMaxLength(500);
            e.Property(t => t.DetectedLanguages).HasMaxLength(50);
            e.Property(t => t.CreatedAt).HasDefaultValueSql("GETUTCDATE()");

            e.HasOne(t => t.Project)
             .WithMany()
             .HasForeignKey(t => t.ProjectId)
             .OnDelete(DeleteBehavior.Cascade);

            e.HasMany(t => t.Segments)
             .WithOne(s => s.Transcript)
             .HasForeignKey(s => s.TranscriptId)
             .OnDelete(DeleteBehavior.Cascade);

            e.HasIndex(t => t.ProjectId);
            e.HasIndex(t => t.CreatedAt);
        });

        // ── TranscriptSegment ─────────────────────────────────────────────────
        modelBuilder.Entity<TranscriptSegment>(e =>
        {
            e.ToTable("TranscriptSegments");
            e.HasKey(s => s.Id);
            e.Property(s => s.Speaker).IsRequired().HasMaxLength(20);
            e.Property(s => s.Language).HasMaxLength(10);
            e.Property(s => s.Text).HasMaxLength(5000);
        });
    }
}
