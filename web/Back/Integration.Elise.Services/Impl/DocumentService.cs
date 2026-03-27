using Integration.Elise.EliseSoapServiceFacade.Adapters;
using Integration.Elise.EliseSoapServiceFacade.DAO;
using Integration.Elise.EliseSoapServiceFacade.DTO.EliseDocument.Creation;
using Integration.Elise.EliseSoapServiceFacade.DTO.EliseDocument.CustomFields;
using Integration.Elise.EliseSoapServiceFacade.EliseWebService;
using Integration.Elise.Services.Interfaces;
using Integration.Elise.Services.Models;
using Integration.Elise.Web.Core.Webhook;
using Serilog;

namespace Integration.Elise.Services.Impl
{
    public class DocumentService(IEliseServiceDAO eliseService, ICustomActionProvider customActionProvider , ILogger logger) : IDocumentService
    {
        
        private IEnumerable<string> GetSampleAnomalies(EliseDocumentAdapter document)
        {
            if (document.State != EliseMailState.InCirculation)
            {
                yield return "Le document doit être \"en circulation\"";
            }
        }
        public async Task<SampleResponse> GetSampleAsync()
        {
            SampleResponse res = new SampleResponse();
            eliseService.SetContext(customActionProvider.GetUserLogin(), customActionProvider.GetInstance());
            logger.Information($"id: {customActionProvider.GetDocumentsId()}");
            EliseDocumentAdapter document =  await eliseService.GetDocumentAsync(customActionProvider.GetDocumentsId());
            res.Anomalies = GetSampleAnomalies(document);
            if (!res.AllowChange)
            {
                return res;
            }
          
            res.Subject = document.CustomFields.GetField<CustomFieldText>("df").Value;
            return res;
        }
        public async  Task<SampleResponse> SubmitSampleAsync(SampleRequest req)
        {
            SampleResponse res = new SampleResponse();
            eliseService.SetContext(customActionProvider.GetUserLogin(), customActionProvider.GetInstance());


            EliseDocumentAdapter document = await eliseService.GetDocumentAsync(customActionProvider.GetDocumentsId());
            res.Anomalies = GetSampleAnomalies(document);
            if (!res.AllowChange)
            {
                return res;
            }

            DocumentMetadataList metas = new DocumentMetadataList();
            metas.Add("mailId", customActionProvider.GetDocumentsId());
            metas.Add("Subject", req.Subject);
            metas.Add("CP_INFO", req.Subject);

            DocumentCreationRequest dcr = new DocumentCreationRequest();
            dcr.MetadataList= metas;
            dcr.MappingName ="auto-default";

            await eliseService.CreateDocumentFromMetadataAsync(dcr);

            res.Message = "Success";
            return res;
        }
    }




    

}