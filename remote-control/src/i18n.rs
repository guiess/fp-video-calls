#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Lang {
    Ru,
    En,
}

impl Lang {
    pub const ALL: &'static [Lang] = &[Lang::Ru, Lang::En];

    pub fn label(self) -> &'static str {
        match self {
            Lang::Ru => "Русский",
            Lang::En => "English",
        }
    }
}

impl Default for Lang {
    fn default() -> Self {
        Lang::Ru
    }
}

/// All user-facing strings.
pub struct T;

impl T {
    // -- App / Home --
    pub fn app_title(l: Lang) -> &'static str {
        match l { Lang::Ru => "M2 Удалённое управление", Lang::En => "M2 Remote Control" }
    }
    pub fn app_subtitle(l: Lang) -> &'static str {
        match l { Lang::Ru => "Удалённый рабочий стол", Lang::En => "Remote desktop control" }
    }
    pub fn server(l: Lang) -> &'static str {
        match l { Lang::Ru => "Сервер:", Lang::En => "Server:" }
    }
    pub fn share_my_screen(l: Lang) -> &'static str {
        match l { Lang::Ru => "🖥️  Показать мой экран", Lang::En => "🖥️  Share My Screen" }
    }
    pub fn share_description(l: Lang) -> &'static str {
        match l { Lang::Ru => "Дать другим видеть и управлять экраном", Lang::En => "Let others view and control your screen" }
    }
    pub fn connect_to_remote(l: Lang) -> &'static str {
        match l { Lang::Ru => "🔗  Подключиться", Lang::En => "🔗  Connect to Remote" }
    }
    pub fn connect_description(l: Lang) -> &'static str {
        match l { Lang::Ru => "Видеть и управлять удалённым экраном", Lang::En => "View and control a remote screen" }
    }
    pub fn back(l: Lang) -> &'static str {
        match l { Lang::Ru => "← Назад", Lang::En => "← Back" }
    }

    // -- Host --
    pub fn host_title(l: Lang) -> &'static str {
        match l { Lang::Ru => "🖥️ Показ экрана", Lang::En => "🖥️ Share My Screen" }
    }
    pub fn host_idle(l: Lang) -> &'static str {
        match l { Lang::Ru => "Начните показ, чтобы получить код сессии.", Lang::En => "Start sharing to get a session code that others can use to connect." }
    }
    pub fn start_sharing(l: Lang) -> &'static str {
        match l { Lang::Ru => "▶  Начать показ", Lang::En => "▶  Start Sharing" }
    }
    pub fn connecting_to_server(l: Lang) -> &'static str {
        match l { Lang::Ru => "Подключение к серверу...", Lang::En => "Connecting to server..." }
    }
    pub fn share_code_prompt(l: Lang) -> &'static str {
        match l { Lang::Ru => "Сообщите этот код зрителю:", Lang::En => "Share this code with the viewer:" }
    }
    pub fn copy_code(l: Lang) -> &'static str {
        match l { Lang::Ru => "📋 Копировать код", Lang::En => "📋 Copy Code" }
    }
    pub fn waiting_for_viewer(l: Lang) -> &'static str {
        match l { Lang::Ru => "Ожидание подключения зрителя...", Lang::En => "Waiting for viewer to connect..." }
    }
    pub fn stop_sharing(l: Lang) -> &'static str {
        match l { Lang::Ru => "⏹  Остановить показ", Lang::En => "⏹  Stop Sharing" }
    }
    pub fn viewer_connected(l: Lang) -> &'static str {
        match l { Lang::Ru => "✅ Зритель подключён", Lang::En => "✅ Viewer connected" }
    }
    pub fn control_active_warning(l: Lang) -> &'static str {
        match l { Lang::Ru => "⚠ Удалённое управление ВКЛЮЧЕНО", Lang::En => "⚠ Remote control is ACTIVE" }
    }
    pub fn revoke_control(l: Lang) -> &'static str {
        match l { Lang::Ru => "🔒 Отозвать управление", Lang::En => "🔒 Revoke Control" }
    }
    pub fn control_disabled(l: Lang) -> &'static str {
        match l { Lang::Ru => "Удалённое управление отключено.", Lang::En => "Remote control is disabled." }
    }
    pub fn retry(l: Lang) -> &'static str {
        match l { Lang::Ru => "Повторить", Lang::En => "Retry" }
    }
    pub fn viewer_requests_control(l: Lang) -> &'static str {
        match l { Lang::Ru => "🔔 Зритель запрашивает управление!", Lang::En => "🔔 Viewer requests control!" }
    }
    pub fn allow(l: Lang) -> &'static str {
        match l { Lang::Ru => "✅ Разрешить", Lang::En => "✅ Allow" }
    }
    pub fn deny(l: Lang) -> &'static str {
        match l { Lang::Ru => "❌ Отклонить", Lang::En => "❌ Deny" }
    }

    // -- Client --
    pub fn client_title(l: Lang) -> &'static str {
        match l { Lang::Ru => "🔗 Подключение", Lang::En => "🔗 Connect to Remote" }
    }
    pub fn enter_code(l: Lang) -> &'static str {
        match l { Lang::Ru => "Введите код сессии от хоста:", Lang::En => "Enter the session code from the host:" }
    }
    pub fn connect(l: Lang) -> &'static str {
        match l { Lang::Ru => "🔗  Подключиться", Lang::En => "🔗  Connect" }
    }
    pub fn connecting(l: Lang) -> &'static str {
        match l { Lang::Ru => "Подключение...", Lang::En => "Connecting..." }
    }
    pub fn connected(l: Lang) -> &'static str {
        match l { Lang::Ru => "✅ Подключено", Lang::En => "✅ Connected" }
    }
    pub fn controlling(l: Lang) -> &'static str {
        match l { Lang::Ru => "🎮 Управление", Lang::En => "🎮 Controlling" }
    }
    pub fn release(l: Lang) -> &'static str {
        match l { Lang::Ru => "Отпустить", Lang::En => "Release" }
    }
    pub fn requesting(l: Lang) -> &'static str {
        match l { Lang::Ru => "Запрос…", Lang::En => "Requesting…" }
    }
    pub fn request_control(l: Lang) -> &'static str {
        match l { Lang::Ru => "🖱️ Запросить управление", Lang::En => "🖱️ Request Control" }
    }
    pub fn disconnect(l: Lang) -> &'static str {
        match l { Lang::Ru => "⏹ Отключиться", Lang::En => "⏹ Disconnect" }
    }

    // -- Common --
    pub fn language(l: Lang) -> &'static str {
        match l { Lang::Ru => "Язык:", Lang::En => "Language:" }
    }
}
