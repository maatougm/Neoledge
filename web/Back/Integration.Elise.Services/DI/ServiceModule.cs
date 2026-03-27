/**
 * @file     ServiceModule.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     Autofac module — registers all services and repositories for DI
 */

using Autofac;
using AutoMapper;
using Integration.Elise.Services.Impl;
using Integration.Elise.Services.Interfaces;
using Integration.Elise.Services.Models.DTOs;
using Integration.Elise.Services.Repositories;
using Integration.Elise.Services.Services;

namespace Integration.Elise.Services.DI;

/// <summary>
/// Autofac module that registers all application services, repositories, and AutoMapper profiles.
/// Registered with <c>InstancePerLifetimeScope</c> so each HTTP request gets its own instances.
/// </summary>
public class ServiceModule : Module
{
    protected override void Load(ContainerBuilder builder)
    {
        // ── Existing services ─────────────────────────────────────────────────
        builder.RegisterType<DocumentService>().As<IDocumentService>().InstancePerLifetimeScope();

        // ── Repositories ──────────────────────────────────────────────────────
        builder.RegisterType<AppUserRepository>().As<IAppUserRepository>().InstancePerLifetimeScope();
        builder.RegisterType<ProjectRepository>().As<IProjectRepository>().InstancePerLifetimeScope();
        builder.RegisterType<ProjectValidationRepository>().As<IProjectValidationRepository>().InstancePerLifetimeScope();
        builder.RegisterType<ProjectActivityRepository>().As<IProjectActivityRepository>().InstancePerLifetimeScope();
        builder.RegisterType<ProjectTemplateRepository>().As<IProjectTemplateRepository>().InstancePerLifetimeScope();

        // ── Services ──────────────────────────────────────────────────────────
        builder.RegisterType<AppUserService>().As<IAppUserService>().InstancePerLifetimeScope();
        builder.RegisterType<ProjectService>().As<IProjectService>().InstancePerLifetimeScope();
        builder.RegisterType<AuthService>().As<IAuthService>().InstancePerLifetimeScope();
        builder.RegisterType<PhaseGateService>().As<IPhaseGateService>().InstancePerLifetimeScope();
        builder.RegisterType<EmailService>().As<IEmailService>().InstancePerLifetimeScope();
        builder.RegisterType<ProjectTemplateService>().As<IProjectTemplateService>().InstancePerLifetimeScope();

        // ── New Services ──────────────────────────────────────────────────────
        builder.RegisterType<DashboardService>().As<IDashboardService>().InstancePerLifetimeScope();
        builder.RegisterType<CommentService>().As<ICommentService>().InstancePerLifetimeScope();
        builder.RegisterType<UserProfileService>().As<IUserProfileService>().InstancePerLifetimeScope();
        builder.RegisterType<AttachmentService>().As<IAttachmentService>().InstancePerLifetimeScope();
        builder.RegisterType<ExportService>().As<IExportService>().InstancePerLifetimeScope();

        // ── AutoMapper ────────────────────────────────────────────────────────
        builder.Register(_ => new MapperConfiguration(cfg =>
        {
            cfg.AddProfile<AppUserMappingProfile>();
            cfg.AddProfile<ProjectMappingProfile>();
        })).AsSelf().SingleInstance();

        builder.Register(ctx => ctx.Resolve<MapperConfiguration>().CreateMapper())
               .As<IMapper>()
               .InstancePerLifetimeScope();
    }
}
