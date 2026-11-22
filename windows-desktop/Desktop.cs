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
    static readonly string Journal = Path.Combine(Root, "Diario CRM");
    static readonly string Files = AppDomain.CurrentDomain.BaseDirectory;
    readonly WebView2 view = new WebView2 { Dock = DockStyle.Fill };
    readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 128 * 1024, RecursionLimit = 24 };
    readonly Timer maintenance = new Timer { Interval = 300000 };
    readonly Dictionary<string,string> bundled = new Dictionary<string,string>(StringComparer.Ordinal) {
        {"/index.html","text/html"},{"/crm-sync.js","text/javascript"},{"/crm-journal.js","text/javascript"},
        {"/reservation-attendance.js","text/javascript"},{"/qrcode.min.js","text/javascript"}
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

    static void JournalStatus() { JournalHost.Run(Journal, new Dictionary<string,object> {{"command","status"}}); }

    static void VerifyJournal()
    {
        Directory.CreateDirectory(Journal);
        if ((File.GetAttributes(Journal) & FileAttributes.ReparsePoint) != 0) throw new IOException();
        var acl = new DirectorySecurity();
        acl.SetAccessRuleProtection(true, false);
        foreach (var sid in new[] {WindowsIdentity.GetCurrent().User, new SecurityIdentifier("S-1-5-18")})
            acl.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.FullControl,
                InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        Directory.SetAccessControl(Journal, acl);
        JournalHost.VerifyStorage(Journal);
    }

    Desktop()
    {
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
            var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Root,"Desktop","Perfil"));
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
            browser.AddWebResourceRequestedFilter(Origin + "/*", CoreWebView2WebResourceContext.All);
            browser.WebResourceRequested += (sender,args) => {
                var uri = new Uri(args.Request.Uri);
                string mime;
                if (!bundled.TryGetValue(uri.AbsolutePath, out mime)) return;
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
                    var result = await Task.Run(() => JournalHost.Run(Journal,message));
                    if (!IsDisposed && browser.Source == StartUrl)
                        browser.PostWebMessageAsJson(json.Serialize(new { id, response = result }));
                } catch (Exception) {
                    if (id != null && !IsDisposed && browser.Source == StartUrl)
                        browser.PostWebMessageAsJson(json.Serialize(new { id, response = new { ok = false } }));
                }
            };
            await browser.AddScriptToExecuteOnDocumentCreatedAsync(File.ReadAllText(Path.Combine(Files,"bootstrap.js")));
            browser.Navigate(StartUrl);
            maintenance.Start();
        } catch (Exception) {
            MessageBox.Show(this,"Falha ao abrir o CRM. Verifique a instalação do Microsoft Edge WebView2.","Grupo Qu4tro");
            Close();
        }
    }
}
