using Microsoft.AspNetCore.Mvc.Filters;

namespace Integration.Elise.Api.Filters
{
    public class ModelStateExceptionFilterAttribute(Serilog.ILogger logger) : ExceptionFilterAttribute
    {
        public override void OnException(ExceptionContext context)
        {
            logger.Error(context.Exception, "Error ");
            logger.Error(context.Exception.StackTrace);

            base.OnException(context);
        }
    }
}
