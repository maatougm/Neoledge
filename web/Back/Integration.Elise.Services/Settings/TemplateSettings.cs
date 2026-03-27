using Integration.Core.JsonSettings;
using Serilog;

namespace Integration.Elise.Services.Settings
{
    /// <summary>
    /// rename to desired section name in json configuration
    /// </summary>
    internal class TemplateSettings : ISettingElement, ITemplateSettings
    {
        public required string Sample { get; set; }
        public required ILogger Logger { get; set; }

        public void VerifyConfiguration() { }

        public void AfterActivation() { }
    }
}