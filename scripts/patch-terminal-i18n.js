/* Patches all locale files in src/i18n/locales/ with:
 *   - nav.terminal      (sidebar label)
 *   - terminal.*        (Terminal page strings)
 * Idempotent: re-running leaves existing values untouched.
 */
const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '..', 'src', 'i18n', 'locales');

const T = {
  ar: {
    nav: 'المحطة الطرفية',
    page_title: 'المحطة الطرفية',
    page_subtitle: 'مشغل أوامر مقيد. أوامر المحفظة وRPC المسموح بها فقط.',
    clear_output: 'مسح',
    input_placeholder: "أدخل أمراً... ('help' للقائمة)",
    input_busy_placeholder: 'قيد التشغيل...',
  },
  de: {
    nav: 'Terminal',
    page_title: 'Terminal',
    page_subtitle: 'Eingeschränkter Befehlsausführer. Nur freigegebene Wallet- und RPC-Befehle.',
    clear_output: 'Leeren',
    input_placeholder: "Befehl eingeben... ('help' für Liste)",
    input_busy_placeholder: 'Wird ausgeführt...',
  },
  en: {
    nav: 'Terminal',
    page_title: 'Terminal',
    page_subtitle: 'Restricted command runner. Whitelisted wallet and RPC commands only.',
    clear_output: 'Clear',
    input_placeholder: "Type a command... ('help' to list)",
    input_busy_placeholder: 'Running...',
  },
  es: {
    nav: 'Terminal',
    page_title: 'Terminal',
    page_subtitle: 'Ejecutor de comandos restringido. Solo comandos de billetera y RPC permitidos.',
    clear_output: 'Limpiar',
    input_placeholder: "Escribe un comando... ('help' para listar)",
    input_busy_placeholder: 'Ejecutando...',
  },
  fr: {
    nav: 'Terminal',
    page_title: 'Terminal',
    page_subtitle: 'Exécuteur de commandes restreint. Uniquement les commandes wallet et RPC autorisées.',
    clear_output: 'Effacer',
    input_placeholder: "Saisir une commande... ('help' pour la liste)",
    input_busy_placeholder: 'En cours...',
  },
  hi: {
    nav: 'टर्मिनल',
    page_title: 'टर्मिनल',
    page_subtitle: 'प्रतिबंधित कमांड रनर। केवल अनुमत वॉलेट और RPC कमांड।',
    clear_output: 'साफ़ करें',
    input_placeholder: "कमांड दर्ज करें... ('help' से सूची देखें)",
    input_busy_placeholder: 'चल रहा है...',
  },
  id: {
    nav: 'Terminal',
    page_title: 'Terminal',
    page_subtitle: 'Pelari perintah terbatas. Hanya perintah dompet dan RPC yang diizinkan.',
    clear_output: 'Hapus',
    input_placeholder: "Ketik perintah... ('help' untuk daftar)",
    input_busy_placeholder: 'Menjalankan...',
  },
  it: {
    nav: 'Terminale',
    page_title: 'Terminale',
    page_subtitle: 'Esecutore di comandi limitato. Solo comandi wallet e RPC autorizzati.',
    clear_output: 'Cancella',
    input_placeholder: "Digita un comando... ('help' per elencare)",
    input_busy_placeholder: 'In esecuzione...',
  },
  ja: {
    nav: 'ターミナル',
    page_title: 'ターミナル',
    page_subtitle: '制限付きコマンドランナー。許可されたウォレットおよびRPCコマンドのみ。',
    clear_output: 'クリア',
    input_placeholder: "コマンドを入力... ('help'で一覧)",
    input_busy_placeholder: '実行中...',
  },
  ko: {
    nav: '터미널',
    page_title: '터미널',
    page_subtitle: '제한된 명령 실행기. 허용된 지갑 및 RPC 명령만 사용 가능합니다.',
    clear_output: '지우기',
    input_placeholder: "명령어 입력... ('help'로 목록 보기)",
    input_busy_placeholder: '실행 중...',
  },
  pt: {
    nav: 'Terminal',
    page_title: 'Terminal',
    page_subtitle: 'Executor de comandos restrito. Apenas comandos de carteira e RPC permitidos.',
    clear_output: 'Limpar',
    input_placeholder: "Digite um comando... ('help' para listar)",
    input_busy_placeholder: 'Executando...',
  },
  ru: {
    nav: 'Терминал',
    page_title: 'Терминал',
    page_subtitle: 'Ограниченный исполнитель команд. Только разрешенные команды кошелька и RPC.',
    clear_output: 'Очистить',
    input_placeholder: "Введите команду... ('help' для списка)",
    input_busy_placeholder: 'Выполнение...',
  },
  tr: {
    nav: 'Terminal',
    page_title: 'Terminal',
    page_subtitle: 'Kısıtlı komut çalıştırıcı. Yalnızca izin verilen cüzdan ve RPC komutları.',
    clear_output: 'Temizle',
    input_placeholder: "Komut girin... ('help' ile listele)",
    input_busy_placeholder: 'Çalışıyor...',
  },
  vi: {
    nav: 'Cửa sổ dòng lệnh',
    page_title: 'Cửa sổ dòng lệnh',
    page_subtitle: 'Trình chạy lệnh hạn chế. Chỉ các lệnh ví và RPC trong danh sách cho phép.',
    clear_output: 'Xóa',
    input_placeholder: "Nhập lệnh... ('help' để xem danh sách)",
    input_busy_placeholder: 'Đang chạy...',
  },
  zh: {
    nav: '终端',
    page_title: '终端',
    page_subtitle: '受限命令运行器。仅允许白名单中的钱包和 RPC 命令。',
    clear_output: '清除',
    input_placeholder: "输入命令...（'help' 查看列表）",
    input_busy_placeholder: '运行中...',
  },
};

let patched = 0;
for (const [code, strings] of Object.entries(T)) {
  const file = path.join(LOCALES_DIR, `${code}.json`);
  if (!fs.existsSync(file)) {
    console.warn(`skip: ${file} does not exist`);
    continue;
  }
  const raw = fs.readFileSync(file, 'utf-8');
  const json = JSON.parse(raw);

  json.nav = json.nav || {};
  if (json.nav.terminal === undefined) json.nav.terminal = strings.nav;

  json.terminal = json.terminal || {};
  if (json.terminal.page_title === undefined) json.terminal.page_title = strings.page_title;
  if (json.terminal.page_subtitle === undefined) json.terminal.page_subtitle = strings.page_subtitle;
  if (json.terminal.clear_output === undefined) json.terminal.clear_output = strings.clear_output;
  if (json.terminal.input_placeholder === undefined) json.terminal.input_placeholder = strings.input_placeholder;
  if (json.terminal.input_busy_placeholder === undefined) json.terminal.input_busy_placeholder = strings.input_busy_placeholder;

  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  patched++;
}
console.log(`patched ${patched} locale files`);
