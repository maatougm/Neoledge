namespace Integration.Elise.Api.Middleware;

public class RequestLoggingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly Serilog.ILogger _logger;

    public RequestLoggingMiddleware(RequestDelegate next, Serilog.ILogger logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var method = context.Request.Method;
        var path = context.Request.Path;
        var correlationId = Guid.NewGuid().ToString("N")[..8];

        context.Response.Headers.Append("X-Correlation-Id", correlationId);

        _logger.Information("[{CorrelationId}] {Method} {Path} — start", correlationId, method, path);

        var sw = System.Diagnostics.Stopwatch.StartNew();
        try
        {
            await _next(context);
            sw.Stop();
            _logger.Information("[{CorrelationId}] {Method} {Path} — {StatusCode} in {Elapsed}ms",
                correlationId, method, path, context.Response.StatusCode, sw.ElapsedMilliseconds);
        }
        catch (Exception ex)
        {
            sw.Stop();
            _logger.Error(ex, "[{CorrelationId}] {Method} {Path} — unhandled exception after {Elapsed}ms",
                correlationId, method, path, sw.ElapsedMilliseconds);
            throw;
        }
    }
}
