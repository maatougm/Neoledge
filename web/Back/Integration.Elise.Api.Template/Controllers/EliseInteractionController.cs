using Integration.Elise.Services.Interfaces;
using Integration.Elise.Services.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Integration.Elise.Api.Controllers
{
    [ApiController]
    [Authorize]
    [Route("[controller]")]
    public class EliseInteractionController : Controller
    {
        private readonly IDocumentService _documentService;
        private readonly Serilog.ILogger _logger;
        public EliseInteractionController(Serilog.ILogger logger,IDocumentService documentService)
        {
            _logger = logger;
            _documentService = documentService;
        }

        [HttpGet]
        [Route("Sample")]
        public async Task<IActionResult> LoadingCustomAction()
        {
            _logger.Information("LoadingCustomAction");
            var result = await _documentService.GetSampleAsync();
            return Ok(result);
        }


        [HttpPost]
        [Route("Sample")]
        public async Task<IActionResult> Sample(SampleRequest req)
        {
            SampleResponse result = await _documentService.SubmitSampleAsync(req);
            return Ok(result);
        }



    }
}