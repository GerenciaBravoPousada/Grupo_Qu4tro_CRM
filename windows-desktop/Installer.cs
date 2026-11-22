using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Principal;
using System.Windows.Forms;

internal static class Installer
{
    const string Name = "Grupo Qu4tro Desktop";
    const string Exe = "GrupoQu4tro.Desktop.exe";

    [STAThread]
    static int Main(string[] args)
    {
        bool verify = args.Length == 1 && args[0] == "--verify-package";
        try {
            string target = verify
                ? Path.Combine(Path.GetTempPath(), "Qu4tro-verify-" + Guid.NewGuid().ToString("N"))
                : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "Grupo Qu4tro", "Desktop", "Versoes", Guid.NewGuid().ToString("N"));
            Extract(target);
            string app = Path.Combine(target, Exe);
            if (Run(app, "--verify-runtime") != 0)
                throw new InvalidOperationException("Instale o Microsoft Edge WebView2 Runtime e tente novamente.");
            if (verify) return 0;
            if (Run(app, "--verify-journal") != 0)
                throw new InvalidOperationException("O diário não passou no teste de gravação e leitura.");
            RegisterMaintenance(app);
            Shortcut(Environment.SpecialFolder.DesktopDirectory, app);
            Shortcut(Environment.SpecialFolder.Programs, app);
            Shortcut(Environment.SpecialFolder.Startup, app);
            Process.Start(new ProcessStartInfo(app) { UseShellExecute = true });
            MessageBox.Show("Pronto para uso. Diário verificado e abertura automática configurada. Para fixar o ícone, clique nele com o botão direito na barra de tarefas.", Name);
            return 0;
        } catch (Exception error) {
            if (!verify) MessageBox.Show("A instalação não foi concluída. " + error.Message, Name);
            return 1;
        }
    }

    static void Extract(string directory)
    {
        Directory.CreateDirectory(directory);
        string prefix = Path.GetFullPath(directory) + Path.DirectorySeparatorChar;
        using (var resource = Assembly.GetExecutingAssembly().GetManifestResourceStream("Qu4troPackage"))
        using (var archive = new ZipArchive(resource, ZipArchiveMode.Read)) {
            foreach (var entry in archive.Entries) {
                if (String.IsNullOrEmpty(entry.Name)) continue;
                string path = Path.GetFullPath(Path.Combine(directory, entry.FullName));
                if (!path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException();
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                using (var source = entry.Open())
                using (var target = new FileStream(path, FileMode.CreateNew, FileAccess.Write)) source.CopyTo(target);
            }
        }
    }

    static int Run(string app, string args)
    {
        using (var process = Process.Start(new ProcessStartInfo(app, args) { UseShellExecute = false, CreateNoWindow = true })) {
            if (!process.WaitForExit(20000)) throw new TimeoutException("A verificação excedeu o tempo limite.");
            return process.ExitCode;
        }
    }

    static void Shortcut(Environment.SpecialFolder folder, string app)
    {
        dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
        dynamic shortcut = shell.CreateShortcut(Path.Combine(Environment.GetFolderPath(folder), Name + ".lnk"));
        shortcut.TargetPath = app;
        shortcut.WorkingDirectory = Path.GetDirectoryName(app);
        shortcut.Description = "Gestão de Clientes com diário local";
        shortcut.Save();
    }

    static void RegisterMaintenance(string app)
    {
        dynamic service = Activator.CreateInstance(Type.GetTypeFromProgID("Schedule.Service"));
        service.Connect();
        dynamic folder = service.GetFolder("\\");
        dynamic task = service.NewTask(0);
        string user = WindowsIdentity.GetCurrent().Name;
        task.RegistrationInfo.Description = "Remove operações do diário local com mais de 72 horas.";
        task.Principal.UserId = user;
        task.Principal.LogonType = 3;
        task.Settings.StartWhenAvailable = true;
        task.Settings.DisallowStartIfOnBatteries = false;
        task.Settings.StopIfGoingOnBatteries = false;
        dynamic trigger = task.Triggers.Create(1);
        trigger.StartBoundary = DateTime.Now.AddMinutes(1).ToString("yyyy-MM-ddTHH:mm:ss");
        trigger.Repetition.Interval = "PT5M";
        dynamic action = task.Actions.Create(0);
        action.Path = app;
        action.Arguments = "--maintenance";
        folder.RegisterTaskDefinition(Name + " - Diario 72h", task, 6, user, null, 3, null);
    }
}
