using Integration.Elise.Services.Models;

namespace Integration.Elise.Services.Interfaces
{
    public interface IDocumentService
    {
        public Task<SampleResponse> GetSampleAsync();
        public Task<SampleResponse> SubmitSampleAsync(SampleRequest req);

    }
}
