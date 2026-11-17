// Derkenar (Mac): menü çubuğunda ve ekranın kenarında duran küçük yakalama aracı.
// Herhangi bir uygulamada (Preview, Chrome, Word...) metni seç, Derkenar düğmesine bas,
// bir renk seç: bölüm o renkle (kategoriyle), kaynağı ve varsa sayfa numarasıyla kütüphaneye kaydedilir.
//
// Seçili metni okumak için macOS Erişilebilirlik iznini kullanır.

import Cocoa
import ApplicationServices
import ServiceManagement

// MARK: - Renk kategorileri

struct Category {
    let key: String
    let hex: String
    let name: String
}

let palette: [Category] = [
    Category(key: "yellow", hex: "#f6c945", name: "Sarı"),
    Category(key: "green", hex: "#6fcf7c", name: "Yeşil"),
    Category(key: "blue", hex: "#6aaef5", name: "Mavi"),
    Category(key: "pink", hex: "#f58fb0", name: "Pembe"),
    Category(key: "purple", hex: "#b48cf2", name: "Mor"),
]

func category(_ key: String) -> Category {
    return palette.first { $0.key == key } ?? palette[0]
}

func nsColor(hex: String) -> NSColor {
    var value: UInt64 = 0
    Scanner(string: hex.replacingOccurrences(of: "#", with: "")).scanHexInt64(&value)
    return NSColor(
        srgbRed: CGFloat((value >> 16) & 0xff) / 255,
        green: CGFloat((value >> 8) & 0xff) / 255,
        blue: CGFloat(value & 0xff) / 255,
        alpha: 1)
}

// MARK: - Ayarlar

struct Connection: Codable, Equatable {
    let u: String   // sunucu adresi
    let k: String   // açık anahtar
    let t: String   // bağlantı kodu
    var a: String?  // uygulama adresi
}

/// Web uygulamasının ürettiği bağlantı kodunu çözer: base64(JSON {u, k, t, a}).
func decodeConnectionCode(_ code: String) -> Connection? {
    var clean = String(code.unicodeScalars.filter { !CharacterSet.whitespacesAndNewlines.contains($0) })
    while clean.count % 4 != 0 { clean.append("=") }
    guard let data = Data(base64Encoded: clean),
          let conn = try? JSONDecoder().decode(Connection.self, from: data),
          conn.u.hasPrefix("http"), !conn.k.isEmpty, conn.t.count >= 32
    else { return nil }
    return conn
}

enum Settings {
    static let defaults = UserDefaults.standard

    static var connection: Connection? {
        get {
            guard let data = defaults.data(forKey: "connection") else { return nil }
            return try? JSONDecoder().decode(Connection.self, from: data)
        }
        set {
            if let value = newValue, let data = try? JSONEncoder().encode(value) {
                defaults.set(data, forKey: "connection")
            } else {
                defaults.removeObject(forKey: "connection")
            }
        }
    }

    static var names: [String: String] {
        get { return (defaults.dictionary(forKey: "names") as? [String: String]) ?? [:] }
        set { defaults.set(newValue, forKey: "names") }
    }

    static var lastColor: String {
        get { return defaults.string(forKey: "lastColor") ?? "yellow" }
        set { defaults.set(newValue, forKey: "lastColor") }
    }

    static var bubbleHidden: Bool {
        get { return defaults.bool(forKey: "bubbleHidden") }
        set { defaults.set(newValue, forKey: "bubbleHidden") }
    }

    static var bubbleOrigin: NSPoint? {
        get {
            guard defaults.object(forKey: "bubbleX") != nil else { return nil }
            return NSPoint(x: defaults.double(forKey: "bubbleX"), y: defaults.double(forKey: "bubbleY"))
        }
        set {
            if let p = newValue {
                defaults.set(Double(p.x), forKey: "bubbleX")
                defaults.set(Double(p.y), forKey: "bubbleY")
            }
        }
    }

    static func name(for key: String) -> String {
        let custom = (names[key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return custom.isEmpty ? category(key).name : custom
    }
}

// MARK: - Metin ve bağlam (saf işlevler; --self-test ile sınanır)

/// Pencere başlığından sayfa numarası: "Kitap.pdf – Page 106 of 185", "Sayfa 106 / 185".
/// `loose` yalnızca kısa araç çubuğu etiketlerinde ("106 of 185") kullanılır.
func parsePage(_ text: String, loose: Bool = false) -> String? {
    var patterns = ["(?:Page|Sayfa|Seite|Página|Pagina)\\s+(\\d+)"]
    if loose { patterns.append("^\\s*(\\d+)\\s*(?:of|/|von|de|di)\\s*\\d+\\s*$") }
    for pattern in patterns {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { continue }
        let range = NSRange(text.startIndex..., in: text)
        if let match = regex.firstMatch(in: text, options: [], range: range),
           let r = Range(match.range(at: 1), in: text) {
            return String(text[r])
        }
    }
    return nil
}

/// Başlıktaki sayfa bilgisini ve ayırıcıyı atar: "Kitap.pdf – Page 106 of 185" -> "Kitap.pdf".
func cleanWindowTitle(_ title: String) -> String {
    var out = title
    if let regex = try? NSRegularExpression(
        pattern: "\\s*[–—-]\\s*(?:Page|Sayfa|Seite|Página|Pagina)\\s+\\d+.*$", options: [.caseInsensitive]) {
        out = regex.stringByReplacingMatches(in: out, options: [], range: NSRange(out.startIndex..., in: out), withTemplate: "")
    }
    return out.trimmingCharacters(in: .whitespacesAndNewlines)
}

/// Kopyalanan metni tek paragrafa çevirir; satır sonunda bölünmüş sözcükleri birleştirir.
func normalizeSelection(_ raw: String) -> String {
    let lines = raw.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        .components(separatedBy: "\n")
        .map { $0.trimmingCharacters(in: .whitespaces) }
        .filter { !$0.isEmpty }
    var out = ""
    for line in lines {
        if out.isEmpty { out = line; continue }
        let endsWithHyphen = out.hasSuffix("-") || out.hasSuffix("\u{00AD}") || out.hasSuffix("\u{2010}")
        let beforeHyphen = out.dropLast().last
        let startsLower = line.first.map { $0.isLetter && $0.isLowercase } ?? false
        if endsWithHyphen, let prev = beforeHyphen, prev.isLetter, startsLower {
            out = String(out.dropLast()) + line
        } else {
            out += " " + line
        }
    }
    return out.components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
}

struct CaptureContext {
    var appName = ""
    var bundleId = ""
    var windowTitle = ""
    var documentPath: String?
    var page: String?
    var url: String?
    var pageTitle: String?
}

/// Sunucuya gönderilecek kayıt: kaynak, adres ya da dosya adıyla belirlenir.
func buildPayload(text: String, colorHex: String, context: CaptureContext) -> [String: Any] {
    var payload: [String: Any] = ["text": text, "color": colorHex, "origin": "mac", "device": "Mac"]
    if let raw = context.url, raw.hasPrefix("http") {
        let clean = raw.components(separatedBy: "#")[0]
        payload["url"] = clean
        payload["title"] = (context.pageTitle?.isEmpty == false) ? context.pageTitle! : cleanWindowTitle(context.windowTitle)
        payload["kind"] = "web"
    } else {
        var fileName = ""
        if let path = context.documentPath, !path.isEmpty {
            fileName = (path as NSString).lastPathComponent
        } else {
            let title = cleanWindowTitle(context.windowTitle)
            if title.lowercased().hasSuffix(".pdf") || title.lowercased().hasSuffix(".epub") { fileName = title }
            else { payload["title"] = title.isEmpty ? context.appName : title }
        }
        if !fileName.isEmpty {
            payload["file_name"] = fileName
            payload["title"] = (fileName as NSString).deletingPathExtension
        }
        payload["kind"] = fileName.lowercased().hasSuffix(".pdf") ? "pdf" : "other"
    }
    if let page = context.page, !page.isEmpty { payload["page"] = page }
    return payload
}

// MARK: - Erişilebilirlik (başka uygulamadaki seçimi ve pencere bilgisini okuma)

func axCopy(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
    var value: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    return result == .success ? value : nil
}

func axString(_ element: AXUIElement, _ attribute: String) -> String? {
    return axCopy(element, attribute) as? String
}

func axElement(_ element: AXUIElement, _ attribute: String) -> AXUIElement? {
    guard let value = axCopy(element, attribute), CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return (value as! AXUIElement)
}

func axChildren(_ element: AXUIElement) -> [AXUIElement] {
    return (axCopy(element, kAXChildrenAttribute as String) as? [AXUIElement]) ?? []
}

/// Uygulamanın menüsündeki "Kopyala" (⌘C) öğesine basar; klavye düzeninden bağımsızdır.
func pressCopyMenuItem(_ app: AXUIElement) -> Bool {
    guard let bar = axElement(app, kAXMenuBarAttribute as String) else { return false }
    for top in axChildren(bar) {
        for menu in axChildren(top) {
            for item in axChildren(menu) {
                guard let char = axString(item, kAXMenuItemCmdCharAttribute as String), char.uppercased() == "C" else { continue }
                let modifiers = (axCopy(item, kAXMenuItemCmdModifiersAttribute as String) as? Int) ?? 0
                if modifiers == 0 {
                    return AXUIElementPerformAction(item, kAXPressAction as CFString) == .success
                }
            }
        }
    }
    return false
}

func postCommandC() {
    let source = CGEventSource(stateID: .combinedSessionState)
    let down = CGEvent(keyboardEventSource: source, virtualKey: 8, keyDown: true)
    let up = CGEvent(keyboardEventSource: source, virtualKey: 8, keyDown: false)
    down?.flags = .maskCommand
    up?.flags = .maskCommand
    down?.post(tap: .cghidEventTap)
    up?.post(tap: .cghidEventTap)
}

typealias PasteboardSnapshot = [[NSPasteboard.PasteboardType: Data]]

func snapshotPasteboard() -> PasteboardSnapshot {
    return (NSPasteboard.general.pasteboardItems ?? []).map { item in
        var contents: [NSPasteboard.PasteboardType: Data] = [:]
        for type in item.types {
            if let data = item.data(forType: type) { contents[type] = data }
        }
        return contents
    }
}

func restorePasteboard(_ snapshot: PasteboardSnapshot) {
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    let items: [NSPasteboardItem] = snapshot.map { contents in
        let item = NSPasteboardItem()
        for (type, data) in contents { item.setData(data, forType: type) }
        return item
    }
    if !items.isEmpty { pasteboard.writeObjects(items) }
}

func waitForPasteboardChange(from count: Int, tries: Int = 30) -> String? {
    let pasteboard = NSPasteboard.general
    for _ in 0..<tries {
        if pasteboard.changeCount != count { return pasteboard.string(forType: .string) }
        usleep(20_000)
    }
    return nil
}

/// Öndeki uygulamada seçili metni döndürür. Önce doğrudan okur; olmazsa
/// kopyalayıp panodan alır ve panoyu eski haline getirir.
func grabSelection(pid: pid_t) -> String? {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 1.5)
    if let focused = axElement(app, kAXFocusedUIElementAttribute as String),
       let direct = axString(focused, kAXSelectedTextAttribute as String) {
        let text = normalizeSelection(direct)
        if !text.isEmpty { return text }
    }
    let pasteboard = NSPasteboard.general
    let snapshot = snapshotPasteboard()
    let before = pasteboard.changeCount
    var copied: String?
    if pressCopyMenuItem(app) { copied = waitForPasteboardChange(from: before) }
    if copied == nil {
        postCommandC()
        copied = waitForPasteboardChange(from: before)
    }
    if pasteboard.changeCount != before { restorePasteboard(snapshot) }
    guard let raw = copied else { return nil }
    let text = normalizeSelection(raw)
    return text.isEmpty ? nil : text
}

/// Pencerenin araç çubuğunda "Page 106 of 185" gibi bir etiket arar (sınırlı derinlikte).
func findPageLabel(in window: AXUIElement) -> String? {
    var queue: [(AXUIElement, Int)] = [(window, 0)]
    var visited = 0
    while !queue.isEmpty && visited < 250 {
        let (element, depth) = queue.removeFirst()
        visited += 1
        for attribute in [kAXValueAttribute as String, kAXTitleAttribute as String, kAXDescriptionAttribute as String] {
            if let text = axString(element, attribute), text.count < 40, let page = parsePage(text, loose: true) {
                return page
            }
        }
        if depth < 5 {
            // Belge içeriğine (PDF sayfalarına) inmeden yalnızca pencere kabuğunu tara.
            let role = axString(element, kAXRoleAttribute as String) ?? ""
            if role == "AXScrollArea" || role == "AXWebArea" { continue }
            for child in axChildren(element) { queue.append((child, depth + 1)) }
        }
    }
    return nil
}

let chromiumBrowsers: Set<String> = [
    "com.google.Chrome", "com.brave.Browser", "com.microsoft.edgemac", "company.thebrowser.Browser",
    "org.chromium.Chromium", "com.vivaldi.Vivaldi",
]

/// Tarayıcılarda etkin sekmenin adresini ve başlığını sorar (macOS bir kez izin ister).
func browserInfo(bundleId: String) -> (url: String, title: String)? {
    var script: String?
    if chromiumBrowsers.contains(bundleId) {
        script = "tell application id \"\(bundleId)\" to return {URL of active tab of front window, title of active tab of front window}"
    } else if bundleId == "com.apple.Safari" {
        script = "tell application id \"com.apple.Safari\" to return {URL of front document, name of front document}"
    }
    guard let source = script, let apple = NSAppleScript(source: source) else { return nil }
    var error: NSDictionary?
    let result = apple.executeAndReturnError(&error)
    guard error == nil, result.numberOfItems >= 2,
          let url = result.atIndex(1)?.stringValue, let title = result.atIndex(2)?.stringValue
    else { return nil }
    return (url, title)
}

func captureContext(app: NSRunningApplication) -> CaptureContext {
    var context = CaptureContext()
    context.appName = app.localizedName ?? ""
    context.bundleId = app.bundleIdentifier ?? ""
    let element = AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetMessagingTimeout(element, 1.5)
    let window = axElement(element, kAXFocusedWindowAttribute as String) ?? axElement(element, kAXMainWindowAttribute as String)
    if let window = window {
        context.windowTitle = axString(window, kAXTitleAttribute as String) ?? ""
        if let document = axString(window, kAXDocumentAttribute as String) {
            context.documentPath = URL(string: document)?.path ?? document
        }
        context.page = parsePage(context.windowTitle) ?? findPageLabel(in: window)
    }
    if let info = browserInfo(bundleId: context.bundleId) {
        context.url = info.url
        context.pageTitle = info.title
        context.page = nil
    }
    return context
}

// MARK: - Sunucu

enum ApiError: Error {
    case notConnected
    case server(String)
    case network
}

func rpc(_ function: String, _ arguments: [String: Any], completion: @escaping (Result<Any, ApiError>) -> Void) {
    guard let conn = Settings.connection, let url = URL(string: "\(conn.u)/rest/v1/rpc/\(function)") else {
        completion(.failure(.notConnected))
        return
    }
    var body = arguments
    body["p_token"] = conn.t
    var request = URLRequest(url: url, timeoutInterval: 20)
    request.httpMethod = "POST"
    request.setValue(conn.k, forHTTPHeaderField: "apikey")
    request.setValue("Bearer \(conn.k)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try? JSONSerialization.data(withJSONObject: body)
    URLSession.shared.dataTask(with: request) { data, response, _ in
        var result: Result<Any, ApiError> = .failure(.network)
        if let data = data, let http = response as? HTTPURLResponse {
            let json = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
            if (200..<300).contains(http.statusCode), let json = json {
                result = .success(json)
            } else {
                let message = (json as? [String: Any])?["message"] as? String
                result = .failure(.server(message ?? "Sunucu hatası (\(http.statusCode))"))
            }
        }
        DispatchQueue.main.async { completion(result) }
    }.resume()
}

// MARK: - Görünüm: simge, düğme, bildirim

func barsImage(size: CGFloat, color: NSColor) -> NSImage {
    return NSImage(size: NSSize(width: size, height: size), flipped: false) { rect in
        color.setFill()
        let h = rect.height * 0.14
        let inset = rect.width * 0.14
        let widths: [CGFloat] = [1, 1, 0.62]
        for (i, w) in widths.enumerated() {
            let y = rect.height * (0.70 - CGFloat(i) * 0.25)
            let bar = NSRect(x: inset, y: y, width: (rect.width - inset * 2) * w, height: h)
            NSBezierPath(roundedRect: bar, xRadius: h / 2, yRadius: h / 2).fill()
        }
        return true
    }
}

func dotImage(_ color: NSColor) -> NSImage {
    return NSImage(size: NSSize(width: 12, height: 12), flipped: false) { rect in
        color.setFill()
        NSBezierPath(ovalIn: rect.insetBy(dx: 1, dy: 1)).fill()
        return true
    }
}

final class BubbleView: NSView {
    var onClick: (() -> Void)?
    var ringColor: NSColor = nsColor(hex: palette[0].hex) { didSet { needsDisplay = true } }
    private var dragStart: NSPoint?
    private var windowStart: NSPoint?
    private var dragged = false

    override func draw(_ dirtyRect: NSRect) {
        let circle = bounds.insetBy(dx: 3, dy: 3)
        NSColor(srgbRed: 0.13, green: 0.12, blue: 0.11, alpha: 0.96).setFill()
        NSBezierPath(ovalIn: circle).fill()
        ringColor.setStroke()
        let ring = NSBezierPath(ovalIn: circle.insetBy(dx: 1.5, dy: 1.5))
        ring.lineWidth = 3
        ring.stroke()
        let icon = barsImage(size: bounds.width * 0.42, color: NSColor(white: 0.93, alpha: 1))
        let side = bounds.width * 0.42
        icon.draw(in: NSRect(x: bounds.midX - side / 2, y: bounds.midY - side / 2, width: side, height: side))
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { return true }

    override func mouseDown(with event: NSEvent) {
        dragStart = NSEvent.mouseLocation
        windowStart = window?.frame.origin
        dragged = false
    }

    override func mouseDragged(with event: NSEvent) {
        guard let start = dragStart, let origin = windowStart else { return }
        let now = NSEvent.mouseLocation
        let dx = now.x - start.x, dy = now.y - start.y
        if abs(dx) > 3 || abs(dy) > 3 { dragged = true }
        if dragged { window?.setFrameOrigin(NSPoint(x: origin.x + dx, y: origin.y + dy)) }
    }

    override func mouseUp(with event: NSEvent) {
        if dragged, let origin = window?.frame.origin {
            Settings.bubbleOrigin = origin
        } else {
            onClick?()
        }
        dragStart = nil
    }
}

/// Odak çalmayan yüzen pencere: tıklanınca öndeki uygulama (ve seçim) değişmez.
final class FloatingPanel: NSPanel {
    override var canBecomeKey: Bool { return false }
    override var canBecomeMain: Bool { return false }
}

func makeFloatingPanel(frame: NSRect) -> FloatingPanel {
    let panel = FloatingPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    panel.isFloatingPanel = true
    panel.level = .statusBar
    panel.hidesOnDeactivate = false
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = true
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
    panel.isReleasedWhenClosed = false
    return panel
}

// MARK: - Uygulama

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private var statusItem: NSStatusItem!
    private var bubblePanel: FloatingPanel?
    private var bubbleView: BubbleView?
    private var toastPanel: FloatingPanel?
    private var toastTimer: Timer?
    private var lastExternalApp: NSRunningApplication?
    private let smoke = CommandLine.arguments.contains("--smoke")

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        buildMainMenu()

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        let icon = barsImage(size: 18, color: .black)
        icon.isTemplate = true
        statusItem.button?.image = icon
        statusItem.button?.toolTip = "Derkenar: metni seç, buradan bir renk seç"
        let menu = NSMenu()
        menu.delegate = self
        statusItem.menu = menu

        lastExternalApp = NSWorkspace.shared.frontmostApplication
        NSWorkspace.shared.notificationCenter.addObserver(
            self, selector: #selector(appActivated(_:)), name: NSWorkspace.didActivateApplicationNotification, object: nil)

        if !Settings.bubbleHidden { showBubble() }

        NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            if flags == [.control, .option], event.charactersIgnoringModifiers?.lowercased() == "d" {
                DispatchQueue.main.async { self?.capture(colorKey: Settings.lastColor) }
            }
        }

        if smoke { return }
        if Settings.connection == nil {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self.askConnectionCode() }
        } else {
            refreshNames()
            _ = ensureAccessibility(prompt: true)
        }
    }

    @objc private func appActivated(_ note: Notification) {
        guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
        if app.processIdentifier != ProcessInfo.processInfo.processIdentifier { lastExternalApp = app }
    }

    // Yapıştırma (⌘V) gibi kısayolların bağlantı kodu penceresinde çalışması için.
    private func buildMainMenu() {
        let main = NSMenu()
        let editItem = NSMenuItem()
        let edit = NSMenu(title: "Düzen")
        edit.addItem(withTitle: "Kes", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Kopyala", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Yapıştır", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Tümünü Seç", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        main.addItem(editItem)
        NSApp.mainMenu = main
    }

    // MARK: Menü

    func menuNeedsUpdate(_ menu: NSMenu) {
        fill(menu)
    }

    private func fill(_ menu: NSMenu) {
        menu.removeAllItems()
        let header = NSMenuItem(title: "Seçili metni kaydet", action: nil, keyEquivalent: "")
        header.isEnabled = false
        menu.addItem(header)
        for cat in palette {
            let item = NSMenuItem(title: Settings.name(for: cat.key), action: #selector(saveWithColor(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = cat.key
            item.image = dotImage(nsColor(hex: cat.hex))
            if cat.key == Settings.lastColor { item.toolTip = "Kısayol: ⌃⌥D" }
            menu.addItem(item)
        }
        menu.addItem(.separator())
        if !AXIsProcessTrusted() {
            menu.addItem(actionItem("Erişilebilirlik izni ver…", #selector(openAccessibility)))
        }
        menu.addItem(actionItem(Settings.bubbleHidden ? "Kenar düğmesini göster" : "Kenar düğmesini gizle", #selector(toggleBubble)))
        menu.addItem(actionItem("Kütüphaneyi aç", #selector(openLibrary)))
        menu.addItem(actionItem(Settings.connection == nil ? "Bağlantı kodunu gir…" : "Bağlantı kodunu değiştir…", #selector(askConnectionCode)))
        if #available(macOS 13.0, *) {
            let login = actionItem("Oturum açılışında başlat", #selector(toggleLoginItem))
            login.state = SMAppService.mainApp.status == .enabled ? .on : .off
            menu.addItem(login)
        }
        menu.addItem(.separator())
        menu.addItem(actionItem("Derkenar'dan çık", #selector(quit)))
    }

    private func actionItem(_ title: String, _ action: Selector) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
        item.target = self
        return item
    }

    @objc private func saveWithColor(_ sender: NSMenuItem) {
        guard let key = sender.representedObject as? String else { return }
        // Menü kapanıp öndeki uygulama yeniden etkinleşsin diye kısa bir an bekle.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { self.capture(colorKey: key) }
    }

    @objc private func toggleBubble() {
        Settings.bubbleHidden.toggle()
        if Settings.bubbleHidden { bubblePanel?.orderOut(nil) } else { showBubble() }
    }

    @objc private func openLibrary() {
        if let address = Settings.connection?.a, let url = URL(string: address) { NSWorkspace.shared.open(url) }
        else { toast("Önce bağlantı kodunu gir", error: true) }
    }

    @objc private func openAccessibility() {
        _ = ensureAccessibility(prompt: true)
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            NSWorkspace.shared.open(url)
        }
    }

    @available(macOS 13.0, *)
    @objc private func toggleLoginItem() {
        do {
            if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() }
            else { try SMAppService.mainApp.register() }
        } catch {
            toast("Ayarlanamadı: Sistem Ayarları → Genel → Açılış Öğeleri'nden ekleyebilirsin", error: true)
        }
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }

    private func ensureAccessibility(prompt: Bool) -> Bool {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        return AXIsProcessTrustedWithOptions([key: prompt] as CFDictionary)
    }

    // MARK: Bağlantı

    @objc private func askConnectionCode() {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "Derkenar'ı kütüphanene bağla"
        alert.informativeText = "Derkenar'da Ayarlar → “Eklenti ve kısayol bağlantısı” bölümünden bir bağlantı kodu oluştur, kopyala ve buraya yapıştır (⌘V)."
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 380, height: 72))
        field.placeholderString = "Bağlantı kodu"
        field.usesSingleLineMode = false
        field.cell?.wraps = true
        field.cell?.isScrollable = false
        alert.accessoryView = field
        alert.addButton(withTitle: "Bağlan")
        alert.addButton(withTitle: "Vazgeç")
        alert.window.initialFirstResponder = field
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        guard let conn = decodeConnectionCode(field.stringValue) else {
            toast("Bağlantı kodu okunamadı; kodu eksiksiz yapıştır", error: true)
            return
        }
        Settings.connection = conn
        rpc("token_status", [:]) { result in
            switch result {
            case .success(let json):
                let count = ((json as? [String: Any])?["quotes"] as? Int) ?? 0
                self.toast("Bağlandı. Kütüphanende \(count) alıntı var.")
                self.refreshNames()
                _ = self.ensureAccessibility(prompt: true)
            case .failure(let error):
                Settings.connection = nil
                self.toast(self.describe(error), error: true)
            }
        }
    }

    private func refreshNames() {
        rpc("user_categories", [:]) { result in
            if case .success(let json) = result, let names = json as? [String: String] { Settings.names = names }
        }
    }

    private func describe(_ error: ApiError) -> String {
        switch error {
        case .notConnected: return "Önce bağlantı kodunu gir (menü çubuğundaki Derkenar simgesi)"
        case .server(let message): return message
        case .network: return "Sunucuya ulaşılamadı; internet bağlantını kontrol et"
        }
    }

    // MARK: Yakalama

    private func capture(colorKey: String) {
        guard Settings.connection != nil else { askConnectionCode(); return }
        guard ensureAccessibility(prompt: true) else {
            toast("Seçimi okuyabilmem için Erişilebilirlik izni gerekiyor (menüden “Erişilebilirlik izni ver”)", error: true)
            return
        }
        var target = NSWorkspace.shared.frontmostApplication
        if target == nil || target?.processIdentifier == ProcessInfo.processInfo.processIdentifier { target = lastExternalApp }
        guard let app = target else { toast("Öndeki uygulama bulunamadı", error: true); return }

        guard let text = grabSelection(pid: app.processIdentifier) else {
            toast("Seçili metin bulunamadı. Önce metni seç, sonra rengi seç.", error: true)
            return
        }
        if text.count > 18000 { toast("Seçim çok uzun; daha kısa bir bölüm seç", error: true); return }
        let context = captureContext(app: app)
        let cat = category(colorKey)
        Settings.lastColor = cat.key
        bubbleView?.ringColor = nsColor(hex: cat.hex)
        let payload = buildPayload(text: text, colorHex: cat.hex, context: context)

        rpc("capture", ["p_payload": payload]) { result in
            switch result {
            case .success(let json):
                let duplicate = ((json as? [String: Any])?["duplicate"] as? Bool) ?? false
                var message = duplicate ? "Bu alıntı zaten kayıtlıydı" : "Kaydedildi · \(Settings.name(for: cat.key))"
                if !duplicate, let page = context.page { message += " · s. \(page)" }
                self.toast(message)
            case .failure(let error):
                self.toast(self.describe(error), error: true)
            }
        }
    }

    // MARK: Kenar düğmesi

    private func showBubble() {
        if bubblePanel == nil {
            let size: CGFloat = 52
            var origin = Settings.bubbleOrigin
            let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
            if origin == nil || !NSScreen.screens.contains(where: { $0.frame.contains(origin!) }) {
                origin = NSPoint(x: screen.maxX - size - 14, y: screen.minY + 110)
            }
            let panel = makeFloatingPanel(frame: NSRect(x: origin!.x, y: origin!.y, width: size, height: size))
            let view = BubbleView(frame: NSRect(x: 0, y: 0, width: size, height: size))
            view.ringColor = nsColor(hex: category(Settings.lastColor).hex)
            view.toolTip = "Derkenar: metni seç, buraya bas, renk seç. Sürükleyerek taşıyabilirsin."
            view.onClick = { [weak self] in self?.popUpPalette() }
            panel.contentView = view
            bubblePanel = panel
            bubbleView = view
        }
        bubblePanel?.orderFrontRegardless()
    }

    private func popUpPalette() {
        guard let view = bubbleView else { return }
        let menu = NSMenu()
        fill(menu)
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: view.bounds.height + 6), in: view)
    }

    // MARK: Bildirim

    private func toast(_ message: String, error: Bool = false) {
        toastTimer?.invalidate()
        toastPanel?.orderOut(nil)
        let label = NSTextField(wrappingLabelWithString: message)
        label.textColor = .white
        label.font = .systemFont(ofSize: 13, weight: .medium)
        label.preferredMaxLayoutWidth = 300
        let fitting = label.sizeThatFits(NSSize(width: 300, height: 400))
        let width = min(max(fitting.width, 120), 300) + 28
        let height = fitting.height + 20

        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        var origin = NSPoint(x: screen.maxX - width - 16, y: screen.maxY - height - 12)
        if let bubble = bubblePanel, bubble.isVisible {
            origin = NSPoint(x: min(bubble.frame.maxX - width, screen.maxX - width - 8), y: bubble.frame.maxY + 8)
            origin.x = max(origin.x, screen.minX + 8)
        }
        let panel = makeFloatingPanel(frame: NSRect(x: origin.x, y: origin.y, width: width, height: height))
        panel.ignoresMouseEvents = true
        let background = NSView(frame: NSRect(x: 0, y: 0, width: width, height: height))
        background.wantsLayer = true
        background.layer?.cornerRadius = 10
        background.layer?.backgroundColor = (error
            ? NSColor(srgbRed: 0.64, green: 0.15, blue: 0.17, alpha: 0.97)
            : NSColor(srgbRed: 0.13, green: 0.12, blue: 0.11, alpha: 0.97)).cgColor
        label.frame = NSRect(x: 14, y: 10, width: width - 28, height: fitting.height)
        background.addSubview(label)
        panel.contentView = background
        panel.orderFrontRegardless()
        toastPanel = panel
        toastTimer = Timer.scheduledTimer(withTimeInterval: error ? 5 : 2.4, repeats: false) { [weak self] _ in
            self?.toastPanel?.orderOut(nil)
        }
    }
}

// MARK: - Kendi kendini sınama (derleme sunucusunda çalışır)

func runSelfTest() -> Bool {
    var failures = 0
    func check(_ condition: Bool, _ name: String) {
        if condition { print("  ok  \(name)") } else { failures += 1; print("  HATA \(name)") }
    }

    check(parsePage("Discourse and Practice.pdf – Page 106 of 185") == "106", "Preview başlığından sayfa (İngilizce)")
    check(parsePage("Kitap.pdf – Sayfa 12 / 300") == "12", "Preview başlığından sayfa (Türkçe)")
    check(parsePage("Discourse and Practice.pdf") == nil, "sayfa bilgisi olmayan başlık")
    check(parsePage("Chapter 3 of 10.pdf") == nil, "dosya adındaki sayılar sayfa sanılmaz")
    check(parsePage("106 of 185", loose: true) == "106", "kısa araç çubuğu etiketi")
    check(parsePage("Page 106 of 185", loose: true) == "106", "araç çubuğu etiketi (Page)")
    check(cleanWindowTitle("Discourse and Practice.pdf – Page 106 of 185") == "Discourse and Practice.pdf", "başlıktan sayfa bilgisini atma")
    check(cleanWindowTitle("Notlarım") == "Notlarım", "sade başlık değişmez")

    check(normalizeSelection("Visually, settings are realized by the pres-\nence of foreground\nand background.") ==
          "Visually, settings are realized by the presence of foreground and background.", "satır sonu ve tire birleştirme")
    check(normalizeSelection("  tek   satır  ") == "tek satır", "boşluk sadeleştirme")
    check(normalizeSelection("öz-\nYeterlik") == "öz- Yeterlik", "büyük harfle başlayan satırda tire korunur")
    check(normalizeSelection("\n \n") == "", "boş seçim")

    let sample = "{\"u\":\"https://x.supabase.co\",\"k\":\"sb_publishable_abc\",\"t\":\"\(String(repeating: "a", count: 64))\",\"a\":\"https://example.com/app/\"}"
    let code = Data(sample.utf8).base64EncodedString()
    let conn = decodeConnectionCode(code)
    check(conn?.u == "https://x.supabase.co" && conn?.a == "https://example.com/app/", "bağlantı kodunu çözme")
    check(decodeConnectionCode(String(code.prefix(40)) + "\n" + String(code.dropFirst(40))) == conn, "satıra bölünmüş bağlantı kodu")
    check(decodeConnectionCode("bozuk-kod") == nil, "bozuk bağlantı kodu reddedilir")
    check(decodeConnectionCode(Data("{\"u\":\"https://x\",\"k\":\"k\",\"t\":\"kisa\"}".utf8).base64EncodedString()) == nil, "eksik bağlantı kodu reddedilir")

    var preview = CaptureContext()
    preview.appName = "Preview"
    preview.windowTitle = "Discourse and Practice.pdf – Page 106 of 185"
    preview.documentPath = "/Users/okur/Downloads/Discourse and Practice.pdf"
    preview.page = "106"
    let p1 = buildPayload(text: "alıntı", colorHex: "#6fcf7c", context: preview)
    check(p1["file_name"] as? String == "Discourse and Practice.pdf", "Preview: dosya adı")
    check(p1["title"] as? String == "Discourse and Practice", "Preview: başlık")
    check(p1["kind"] as? String == "pdf" && p1["page"] as? String == "106", "Preview: tür ve sayfa")
    check(p1["color"] as? String == "#6fcf7c" && p1["origin"] as? String == "mac", "renk ve köken")

    var noDocument = CaptureContext()
    noDocument.appName = "Preview"
    noDocument.windowTitle = "Kitap.pdf – Sayfa 12 / 300"
    noDocument.page = "12"
    let p2 = buildPayload(text: "alıntı", colorHex: "#f6c945", context: noDocument)
    check(p2["file_name"] as? String == "Kitap.pdf" && p2["kind"] as? String == "pdf", "belge yolu yoksa başlıktan dosya adı")

    var web = CaptureContext()
    web.appName = "Google Chrome"
    web.windowTitle = "Bir Yazı - Google Chrome"
    web.url = "https://example.com/yazi?id=7#bolum"
    web.pageTitle = "Bir Yazı"
    let p3 = buildPayload(text: "alıntı", colorHex: "#f6c945", context: web)
    check(p3["url"] as? String == "https://example.com/yazi?id=7", "web: adresten # kısmı atılır")
    check(p3["title"] as? String == "Bir Yazı" && p3["kind"] as? String == "web" && p3["page"] == nil, "web: başlık ve tür")

    var other = CaptureContext()
    other.appName = "Notes"
    other.windowTitle = "Okuma notlarım"
    let p4 = buildPayload(text: "alıntı", colorHex: "#f6c945", context: other)
    check(p4["title"] as? String == "Okuma notlarım" && p4["kind"] as? String == "other" && p4["file_name"] == nil, "diğer uygulama: pencere başlığı")

    check(JSONSerialization.isValidJSONObject(["p_token": "x", "p_payload": p1]), "kayıt JSON'a çevrilebilir")
    check(category("green").hex == "#6fcf7c" && category("bilinmeyen").key == "yellow", "renk kategorisi")
    Settings.names = ["green": "Yöntem", "pink": "  "]
    check(Settings.name(for: "green") == "Yöntem" && Settings.name(for: "pink") == "Pembe", "kategori adı: özel ad ya da renk adı")
    Settings.names = [:]

    print(failures == 0 ? "SELFTEST OK" : "SELFTEST BASARISIZ: \(failures)")
    return failures == 0
}

// MARK: - Giriş

if CommandLine.arguments.contains("--self-test") {
    exit(runSelfTest() ? 0 : 1)
}

let application = NSApplication.shared
let appDelegate = AppDelegate()
application.delegate = appDelegate
if CommandLine.arguments.contains("--smoke") {
    DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
        print("SMOKE OK")
        exit(0)
    }
}
application.run()
