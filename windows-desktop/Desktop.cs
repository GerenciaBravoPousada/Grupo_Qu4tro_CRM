using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal sealed class Desktop : Form
{
    const string Origin = "https://crm-grupo-qu4tro.iconiko.com.br";
    const string StartUrl = Origin + "/index.html";
    static readonly string Root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Grupo Qu4tro");
    static readonly string Files = AppDomain.CurrentDomain.BaseDirectory;
    readonly string testRoot;
    bool testPassed;
    readonly WebView2 view = new WebView2 { Dock = DockStyle.Fill };
    readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 128 * 1024, RecursionLimit = 24 };
    readonly Timer maintenance = new Timer { Interval = 300000 };
    readonly Dictionary<string,string> bundled = new Dictionary<string,string>(StringComparer.Ordinal) {
        {"/index.html","text/html"},{"/crm-sync.js","text/javascript"},{"/crm-journal.js","text/javascript"},
        {"/reservation-attendance.js","text/javascript"},{"/qrcode.min.js","text/javascript"},
        {"/crm-journal-browser.js","text/javascript"},{"/crm-phone-privacy.js","text/javascript"},
        {"/crm-action-readiness.js","text/javascript"}
    };

    [STAThread]
    static int Main(string[] args)
    {
        try {
            if (args.Length == 1 && args[0] == "--maintenance") { JournalStatus(); return 0; }
            if (args.Length == 1 && args[0] == "--verify-runtime") {
                return String.IsNullOrEmpty(CoreWebView2Environment.GetAvailableBrowserVersionString()) ? 1 : 0;
            }
            if (args.Length == 1 && args[0] == "--verify-journal") { VerifyJournal(); return 0; }
            bool testing = args.Length == 1 && args[0] == "--verify-ui";
            if (testing) {
                Application.EnableVisualStyles();
                using (var test = new Desktop(Path.Combine(Path.GetTempPath(),"Qu4tro-ui-"+Guid.NewGuid().ToString("N")))) {
                    Application.Run(test);
                    return test.testPassed ? 0 : 2;
                }
            }
            bool created;
            using (var one = new System.Threading.Mutex(true, @"Local\GrupoQu4troDesktop-" + WindowsIdentity.GetCurrent().User.Value, out created)) {
                if (!created) return 0;
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new Desktop());
            }
            return 0;
        } catch (Exception) {
            if (args.Length == 0) MessageBox.Show("Não foi possível iniciar o Grupo Qu4tro Desktop.", "Grupo Qu4tro");
            return 1;
        }
    }

    static void JournalStatus() { JournalHost.RunConfigured(new Dictionary<string,object> {{"command","status"}}); }

    static void VerifyJournal() { JournalHost.SetupDirectory(JournalHost.StandardDirectory, JournalHost.LegacyDirectory); }

    Desktop(string testRoot = null)
    {
        this.testRoot = testRoot;
        Text = "Grupo Qu4tro — Gestão de Clientes";
        Width = 1280;
        Height = 850;
        StartPosition = FormStartPosition.CenterScreen;
        Controls.Add(view);
        Shown += async delegate { await StartAsync(); };
        maintenance.Tick += async delegate {
            try { await Task.Run((Action)JournalStatus); } catch (Exception) {}
        };
        FormClosed += delegate { maintenance.Dispose(); };
    }

    async Task StartAsync()
    {
        try {
            var env = await CoreWebView2Environment.CreateAsync(null, testRoot ?? Path.Combine(Root,"Desktop","Perfil"));
            await view.EnsureCoreWebView2Async(env);
            var browser = view.CoreWebView2;
            browser.Settings.IsPasswordAutosaveEnabled = false;
            browser.Settings.IsGeneralAutofillEnabled = false;
            browser.Settings.AreDevToolsEnabled = false;
            browser.NavigationStarting += (sender,args) => {
                if (args.Uri != StartUrl) args.Cancel = true;
            };
            browser.FrameNavigationStarting += (sender,args) => { args.Cancel = true; };
            browser.NewWindowRequested += (sender,args) => {
                args.Handled = true;
                Uri link;
                if (Uri.TryCreate(args.Uri, UriKind.Absolute, out link) && link.Scheme == "https" &&
                    (link.Host == "api.whatsapp.com" || link.Host == "wa.me"))
                    Process.Start(new ProcessStartInfo(link.AbsoluteUri) { UseShellExecute = true });
            };
            browser.PermissionRequested += (sender,args) => { args.State = CoreWebView2PermissionState.Deny; };
            browser.AddWebResourceRequestedFilter(testRoot == null ? Origin + "/*" : "*", CoreWebView2WebResourceContext.All);
            browser.WebResourceRequested += (sender,args) => {
                var uri = new Uri(args.Request.Uri);
                string mime;
                if (uri.GetLeftPart(UriPartial.Authority) != Origin || !bundled.TryGetValue(uri.AbsolutePath, out mime)) {
                    if (testRoot != null) args.Response = env.CreateWebResourceResponse(new MemoryStream(), 404, "Test", "");
                    return;
                }
                string path = Path.Combine(Files,"web",uri.AbsolutePath.Substring(1));
                var bytes = new MemoryStream(File.ReadAllBytes(path), false);
                args.Response = env.CreateWebResourceResponse(bytes, 200, "OK", "Content-Type: " + mime + "; charset=utf-8\r\nCache-Control: no-store");
            };
            browser.WebMessageReceived += async (sender,args) => {
                if (args.Source != StartUrl || args.WebMessageAsJson.Length > 60000) return;
                string id = null;
                try {
                    var request = json.Deserialize<Dictionary<string,object>>(args.WebMessageAsJson);
                    id = request["id"] as string;
                    Guid parsed;
                    if (!Guid.TryParseExact(id,"D",out parsed)) return;
                    var message = request["message"] as Dictionary<string,object>;
                    var result = await Task.Run(() => testRoot == null
                        ? JournalHost.RunConfigured(message)
                        : JournalHost.RunConfigured(Path.Combine(testRoot,"fixed","test-journal"), Path.Combine(testRoot,"legacy"), message));
                    if (!IsDisposed && browser.Source == StartUrl)
                        browser.PostWebMessageAsJson(json.Serialize(new { id, response = result }));
                } catch (Exception) {
                    if (id != null && !IsDisposed && browser.Source == StartUrl)
                        browser.PostWebMessageAsJson(json.Serialize(new { id, response = new { ok = false } }));
                }
            };
            await browser.AddScriptToExecuteOnDocumentCreatedAsync(File.ReadAllText(Path.Combine(Files,"bootstrap.js")));
            browser.Navigate(StartUrl);
            if (testRoot == null) maintenance.Start();
            else await VerifyUi(browser);
        } catch (Exception) {
            if (testRoot == null) MessageBox.Show(this,"Falha ao abrir o CRM. Verifique a instalação do Microsoft Edge WebView2.","Grupo Qu4tro");
            Close();
        }
    }
    async Task VerifyUi(CoreWebView2 browser)
    {
        string check = @"Boolean(window.qu4troDesktop &&
          document.querySelector('#loginScreenOverlay:not(.hidden)') &&
          document.querySelector('#authOverlayPassword') &&
          !document.querySelector('#authRememberMe') &&
          typeof state !== 'undefined' && !state.currentUser && crmJournalEnabled)";
        for (int i=0;i<40;i++) {
            await Task.Delay(250);
            if (await browser.ExecuteScriptAsync(check) != "true") continue;
            Guid setupId = Guid.NewGuid();
            await browser.ExecuteScriptAsync("window.postMessage({channel:'qu4tro-journal-request',id:'" +
                setupId.ToString("D") + "',message:{command:'setup'}},location.origin)");
            string file = Path.Combine(testRoot,"fixed","test-journal","operacoes.jsonl");
            for(int j=0;j<20 && !File.Exists(file);j++) await Task.Delay(150);
            if(!File.Exists(file)) break;
            Guid id = Guid.NewGuid();
            string request = json.Serialize(new { command = "append", id = id.ToString("D"), action = "WAITLIST",
                details = new { house = "Teste isolado", record = new { id = "piloto" } } });
            await browser.ExecuteScriptAsync("window.postMessage({channel:'qu4tro-journal-request',id:'" +
                id.ToString("D") + "',message:" + request + "},location.origin)");
            for(int j=0;j<20;j++){
                await Task.Delay(150);
                if(File.Exists(file) && File.ReadAllText(file).Contains(id.ToString("D"))){
                    testPassed = true;
                    break;
                }
            }
            break;
        }
        Close();
    }

}
