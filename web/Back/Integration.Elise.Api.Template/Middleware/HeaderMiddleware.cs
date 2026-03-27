using Autofac;
using Integration.Elise.Web.Core.Services;


namespace Integration.Elise.Api.Middleware
{
    public class HeaderMiddleware
    {
        private readonly ILifetimeScope _autofacContainer;
        private readonly RequestDelegate _next;

        public HeaderMiddleware(RequestDelegate next, ILifetimeScope autofacContainer)
        {
            _next = next;
            _autofacContainer = autofacContainer;
        }

        public async Task InvokeAsync(HttpContext context)
        {
            var eliseFramePageService = _autofacContainer.Resolve<IEliseFramePageService>();
            context.Response.OnStarting(() =>
            {
                eliseFramePageService.InjectHeadersAsync(context.Response.Headers).Wait();
                return Task.CompletedTask;
            });
            // Call the next delegate/middleware in the pipeline
            await _next(context);
        }
    }
}
