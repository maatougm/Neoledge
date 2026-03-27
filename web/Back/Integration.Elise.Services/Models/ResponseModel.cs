
namespace Integration.Elise.Services.Models
{
    public class ResponseModel 
    {
        public string Message { get; set; } = string.Empty;
        public bool AllowChange { get => !Anomalies.Any(); }
        public IEnumerable<string> Anomalies { get; set; } = new List<string>();
    }

    public class SampleResponse : ResponseModel
    {
        public string Subject { get; set; } = string.Empty;

    }
}
