using Microsoft.AspNetCore.Mvc;

namespace Integration.Elise.Api.Controllers
{
    [ApiController]
    [Route("[controller]")]
    public class HomeController : Controller
    {
        [HttpGet]
        [Route("")]
        public IActionResult Index()
        {
            return Ok("This website id intended to be called within  Elise and not as a standalone applicaiton");
        }
    }
}
