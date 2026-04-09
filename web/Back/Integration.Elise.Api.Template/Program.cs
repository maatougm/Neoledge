/**
 * @file     Program.cs
 * @module   NeoLeadge — Deployment Manager
 * @author   [dev]
 * @date     2026-03-26
 * @desc     Application entry point — configures services, middleware, and EF Core
 */

using Autofac;
using Autofac.Extensions.DependencyInjection;
using Integration.Elise.Api.Filters;
using Integration.Elise.Api.Middleware;
using Integration.Elise.Services.DI;
using Integration.Elise.Services.Infrastructure;
using Integration.Elise.Web.Core.DI;
using Integration.Elise.Web.Core.Webhook;
using Microsoft.EntityFrameworkCore;
using Serilog;
using System.Text.Json.Serialization;
using DbSeeder = Integration.Elise.Services.Infrastructure.DbSeeder;

var builder = WebApplication.CreateBuilder(args);

// ── Controllers ──────────────────────────────────────────────────────────────
builder.Services.AddControllers()
    .AddJsonOptions(opts =>
    {
        opts.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
        opts.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
    });
builder.Services.AddMvc(option => option.Filters.AddService<ModelStateExceptionFilterAttribute>());

// ── Swagger ───────────────────────────────────────────────────────────────────
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// ── CORS ──────────────────────────────────────────────────────────────────────
builder.Services.AddCors(options =>
{
    options.AddPolicy("all", corsBuilder =>
        corsBuilder
            .WithOrigins("http://localhost:5173", "https://localhost:5173")
            .AllowAnyMethod()
            .AllowAnyHeader()
            .AllowCredentials());
});

// ── EF Core — SQL Server ─────────────────────────────────────────────────────
builder.Services.AddDbContext<ApplicationDbContext>(options =>
    options.UseSqlServer(
        builder.Configuration.GetConnectionString("DefaultConnection"),
        sql => sql.MigrationsAssembly("Integration.Elise.Services")
    ));

// ── Logging ───────────────────────────────────────────────────────────────────
builder.Host.UseSerilog((context, configuration) =>
    configuration.ReadFrom.Configuration(context.Configuration));

// ── JWT Authentication ────────────────────────────────────────────────────────
builder.Services.AddJwtAuthenticationConfig(builder.Configuration);

// ── Autofac ───────────────────────────────────────────────────────────────────
builder.Host
    .UseServiceProviderFactory(new AutofacServiceProviderFactory())
    .ConfigureContainer<ContainerBuilder>(autofacBuilder =>
    {
        autofacBuilder.RegisterType<ModelStateExceptionFilterAttribute>();
        autofacBuilder.RegisterModule(new BaseEliseWebApplicationModule());
        autofacBuilder.RegisterModule(new ServiceModule());
    });

// ─────────────────────────────────────────────────────────────────────────────
var app = builder.Build();

// ── Dev middleware ─────────────────────────────────────────────────────────────
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
    app.UseCors("all");
}

// ── Pipeline ──────────────────────────────────────────────────────────────────
if (!app.Environment.IsDevelopment())
{
    app.UseHttpsRedirection();
}
app.UseAuthentication();
app.UseMiddleware<RequestLoggingMiddleware>();
app.UseAuthorization();
app.MapControllers();
app.UseMiddleware<HeaderMiddleware>();

// ── Seed test users ────────────────────────────────────────────────────────────
await DbSeeder.SeedAsync(app.Services);

app.Run();
