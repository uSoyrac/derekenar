// Derkenar (Mac): menü çubuğunda ve ekranın kenarında duran küçük yakalama aracı.
// Herhangi bir uygulamada (Preview, Chrome, Word...) metni seç, Derkenar düğmesine bas,
// bir renk seç: bölüm o renkle (kategoriyle), kaynağı ve varsa sayfa numarasıyla kütüphaneye kaydedilir.
//
// Seçili metni okumak için macOS Erişilebilirlik iznini kullanır.

import Cocoa
import ApplicationServices
import ServiceManagement
import PDFKit

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

/// Alıntının geçtiği sayfayı PDF dosyasının içinde arayarak bulur. Erişilebilirlik izni gerektirmez
/// ve PDF kendi sayfa etiketlerini taşıyorsa (ör. basılı sayfa numarası) onu döndürür.
/// `hintPage`: pencere başlığından okunan sıra numarası; aynı ifade birden çok sayfada geçerse seçimde kullanılır.
func findPdfPage(path: String, text: String, hintPage: String? = nil) -> String? {
    guard path.lowercased().hasSuffix(".pdf"), let document = PDFDocument(url: URL(fileURLWithPath: path)) else { return nil }
    let words = text.split(separator: " ").map(String.init)
    guard !words.isEmpty else { return nil }
    // Satır sonuna denk gelen parçalar eşleşmeyebilir; uzundan kısaya birkaç parça denenir.
    var candidates: [String] = []
    for count in [8, 5, 3] where words.count >= count { candidates.append(words.prefix(count).joined(separator: " ")) }
    if words.count >= 8 { candidates.append(words[4..<8].joined(separator: " ")) }
    if words.count >= 6 { candidates.append(words.suffix(4).joined(separator: " ")) }
    if candidates.isEmpty { candidates.append(words.joined(separator: " ")) }

    func label(_ page: PDFPage) -> String {
        let own = (page.label ?? "").trimmingCharacters(in: .whitespaces)
        return own.isEmpty ? String(document.index(for: page) + 1) : own
    }
    for candidate in candidates {
        let pages = document.findString(candidate, withOptions: [.caseInsensitive]).compactMap { $0.pages.first }
        if pages.isEmpty { continue }
        if let hint = hintPage, let number = Int(hint),
           let match = pages.first(where: { document.index(for: $0) + 1 == number }) {
            return label(match)
        }
        return label(pages[0])
    }
    return nil
}

/// Bağlantı için açılan web uygulaması (bağlantı kurulunca kütüphane adresi koddan gelir).
let defaultWebApp = "https://usoyrac.github.io/derekenar/"

/// derkenar://connect?code=... adresinden bağlantı kodunu çıkarır.
func connectionCode(fromURL url: URL) -> String? {
    guard url.scheme?.lowercased() == "derkenar", url.host?.lowercased() == "connect",
          let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
          let code = items.first(where: { $0.name == "code" })?.value, !code.isEmpty
    else { return nil }
    return code
}

/// Panodaki metin. Parola yöneticilerinin "gizli" diye işaretlediği içerik okunmaz.
func clipboardText() -> String? {
    let pasteboard = NSPasteboard.general
    let concealed = NSPasteboard.PasteboardType("org.nspasteboard.ConcealedType")
    if pasteboard.types?.contains(concealed) == true { return nil }
    guard let raw = pasteboard.string(forType: .string) else { return nil }
    let text = normalizeSelection(raw)
    return text.isEmpty ? nil : text
}

/// Preview'da öndeki belgenin yolu ve pencere adı (Erişilebilirlik izni gerektirmez; macOS bir kez izin sorar).
func previewInfo() -> (path: String?, windowName: String?)? {
    let source = """
    tell application id "com.apple.Preview"
        set p to ""
        set w to ""
        try
            set p to (path of front document) as text
        end try
        try
            set w to name of front window
        end try
        return {p, w}
    end tell
    """
    guard let apple = NSAppleScript(source: source) else { return nil }
    var error: NSDictionary?
    let result = apple.executeAndReturnError(&error)
    guard error == nil, result.numberOfItems >= 2 else { return nil }
    var path = result.atIndex(1)?.stringValue ?? ""
    // Eski tarz "Disk:Klasör:dosya.pdf" yolu gelirse dosya adı yine doğru çıksın.
    if !path.hasPrefix("/") { path = path.replacingOccurrences(of: ":", with: "/") }
    let name = result.atIndex(2)?.stringValue ?? ""
    return (path.isEmpty ? nil : path, name.isEmpty ? nil : name)
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
    if AXIsProcessTrusted() {
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
    }
    // Preview: belge yolu ve pencere adı doğrudan Preview'a sorulur (izin olmasa da çalışır).
    if context.bundleId == "com.apple.Preview", context.documentPath == nil || context.page == nil,
       let info = previewInfo() {
        if context.documentPath == nil { context.documentPath = info.path }
        if let name = info.windowName {
            if context.windowTitle.isEmpty { context.windowTitle = name }
            if context.page == nil { context.page = parsePage(name) }
        }
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

func describe(_ error: ApiError) -> String {
    switch error {
    case .notConnected: return "Önce bağlantı kodunu gir (Derkenar düğmesi → Kurulum ve bağlantı)"
    case .server(let message): return message
    case .network: return "Sunucuya ulaşılamadı; internet bağlantını kontrol et"
    }
}

let accessibilitySettingsURL = "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"

/// macOS'in izin penceresini gösterir; bu çağrı Derkenar'ı Erişilebilirlik listesine de ekler.
@discardableResult
func requestAccessibility() -> Bool {
    let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
    return AXIsProcessTrustedWithOptions([key: true] as CFDictionary)
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
    var armed = false { didSet { needsDisplay = true } }   // çizim kipi açık
    private var dragStart: NSPoint?
    private var windowStart: NSPoint?
    private var dragged = false

    override func draw(_ dirtyRect: NSRect) {
        let circle = bounds.insetBy(dx: 3, dy: 3)
        (armed ? ringColor : NSColor(srgbRed: 0.13, green: 0.12, blue: 0.11, alpha: 0.96)).setFill()
        NSBezierPath(ovalIn: circle).fill()
        ringColor.setStroke()
        let ring = NSBezierPath(ovalIn: circle.insetBy(dx: 1.5, dy: 1.5))
        ring.lineWidth = 3
        ring.stroke()
        let icon = barsImage(size: bounds.width * 0.42, color: armed ? NSColor(white: 0.1, alpha: 1) : NSColor(white: 0.93, alpha: 1))
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

// MARK: - Kurulum penceresi

/// İlk açılışta iki adımı tek pencerede toplar: kütüphane bağlantısı ve Erişilebilirlik izni.
final class OnboardingController: NSObject, NSWindowDelegate {
    private var window: NSWindow?
    private let codeField = NSTextField()
    private let browserButton = NSButton(title: "Tarayıcıda bağlan (önerilen)", target: nil, action: nil)
    private let connectButton = NSButton(title: "Bağlan", target: nil, action: nil)
    private let connectionStatus = NSTextField(wrappingLabelWithString: "")
    private let accessButton = NSButton(title: "Erişilebilirlik iznini aç", target: nil, action: nil)
    private let accessStatus = NSTextField(wrappingLabelWithString: "")
    private let doneButton = NSButton(title: "Tamam", target: nil, action: nil)
    private var timer: Timer?
    private var message: String?
    private var messageIsError = false
    private var wasTrusted = AXIsProcessTrusted()
    var onConnected: (() -> Void)?
    var onTrusted: (() -> Void)?

    func show(activate: Bool = true) {
        if window == nil { build() }
        refresh()
        if activate { NSApp.activate(ignoringOtherApps: true) }
        window?.center()
        window?.makeKeyAndOrderFront(nil)
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.refresh() }
    }

    private func heading(_ text: String) -> NSTextField {
        let label = NSTextField(labelWithString: text)
        label.font = .boldSystemFont(ofSize: 14)
        return label
    }

    private func paragraph(_ text: String) -> NSTextField {
        let label = NSTextField(wrappingLabelWithString: text)
        label.font = .systemFont(ofSize: 12.5)
        label.textColor = .secondaryLabelColor
        label.preferredMaxLayoutWidth = 440
        return label
    }

    private func build() {
        let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 480, height: 560),
                           styleMask: [.titled, .closable], backing: .buffered, defer: false)
        win.title = "Derkenar"
        win.isReleasedWhenClosed = false
        win.delegate = self

        codeField.placeholderString = "Bağlantı kodunu buraya yapıştır (⌘V)"
        codeField.usesSingleLineMode = false
        codeField.cell?.wraps = true
        codeField.cell?.isScrollable = false
        codeField.translatesAutoresizingMaskIntoConstraints = false
        codeField.widthAnchor.constraint(equalToConstant: 440).isActive = true
        codeField.heightAnchor.constraint(equalToConstant: 58).isActive = true

        browserButton.target = self
        browserButton.action = #selector(connectInBrowser)
        browserButton.bezelStyle = .rounded
        connectButton.target = self
        connectButton.action = #selector(connectFromField)
        connectButton.bezelStyle = .rounded
        accessButton.target = self
        accessButton.action = #selector(requestAccess)
        accessButton.bezelStyle = .rounded
        doneButton.target = self
        doneButton.action = #selector(close)
        doneButton.bezelStyle = .rounded
        doneButton.keyEquivalent = "\r"
        for label in [connectionStatus, accessStatus] {
            label.font = .systemFont(ofSize: 12.5)
            label.preferredMaxLayoutWidth = 440
        }

        let stack = NSStackView(views: [
            heading("1. Kütüphaneye bağlan"),
            paragraph("Düğmeye bas: tarayıcıda Derkenar açılır. Oradaki “Mac uygulamasını bağla” düğmesine bas ve tarayıcının “Derkenar açılsın mı?” sorusuna izin ver."),
            browserButton,
            paragraph("Ya da bağlantı kodunu elle yapıştır:"),
            codeField,
            connectButton,
            connectionStatus,
            heading("2. Kullanım"),
            paragraph("Derkenar arkada çalışır; bu pencereyi kapatabilirsin. Herhangi bir uygulamada metni seç ve kopyala (⌘C). Sonra ekranın sağ kenarındaki yuvarlak Derkenar düğmesine (ya da menü çubuğundaki üç çizgili simgeye) bas ve bir renk seç."),
            heading("İsteğe bağlı: kopyalamadan kaydet"),
            paragraph("Erişilebilirlik izni verirsen ⌘C'ye basman gerekmez; Derkenar seçili metni kendisi okur ve Preview'da sayfa numarasını da alır. İzin vermesen de uygulama çalışır."),
            accessButton,
            accessStatus,
            doneButton,
        ])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 8
        stack.setCustomSpacing(18, after: connectionStatus)
        stack.setCustomSpacing(14, after: accessStatus)
        stack.edgeInsets = NSEdgeInsets(top: 20, left: 20, bottom: 20, right: 20)
        stack.translatesAutoresizingMaskIntoConstraints = false
        let content = NSView()
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            stack.topAnchor.constraint(equalTo: content.topAnchor),
            stack.bottomAnchor.constraint(equalTo: content.bottomAnchor),
        ])
        win.contentView = content
        win.initialFirstResponder = codeField
        window = win
    }

    private func refresh() {
        let connected = Settings.connection != nil
        if let message = message {
            connectionStatus.stringValue = message
            connectionStatus.textColor = messageIsError ? .systemRed : .systemGreen
        } else {
            connectionStatus.stringValue = connected ? "✓ Kütüphaneye bağlı. Kodu değiştirmek için yenisini yapıştırıp Bağlan'a bas." : "Henüz bağlı değil."
            connectionStatus.textColor = connected ? .systemGreen : .secondaryLabelColor
        }
        let trusted = AXIsProcessTrusted()
        accessButton.isHidden = trusted
        accessStatus.stringValue = trusted ? "✓ İzin verildi: kopyalamadan kaydedebilirsin." : "İzin verilmedi: kaydetmeden önce metni kopyala (⌘C)."
        accessStatus.textColor = trusted ? .systemGreen : .secondaryLabelColor
        if trusted && !wasTrusted { wasTrusted = true; onTrusted?() }
        doneButton.isEnabled = connected
    }

    /// Bağlantı kodunu doğrular ve kaydeder (elle yapıştırma ve tarayıcıdan gelen bağlantı ortak yolu).
    func connect(code: String) {
        guard let conn = decodeConnectionCode(code) else {
            message = "Kod okunamadı. Kodun tamamını kopyalayıp yapıştırdığından emin ol."
            messageIsError = true
            refresh()
            return
        }
        let previous = Settings.connection
        Settings.connection = conn
        message = "Bağlanıyor…"
        messageIsError = false
        refresh()
        rpc("token_status", [:]) { result in
            switch result {
            case .success(let json):
                let count = ((json as? [String: Any])?["quotes"] as? Int) ?? 0
                self.codeField.stringValue = ""
                self.message = "✓ Bağlandı. Kütüphanende \(count) alıntı var."
                self.messageIsError = false
                self.onConnected?()
            case .failure(let error):
                Settings.connection = previous
                self.message = describe(error)
                self.messageIsError = true
            }
            self.refresh()
        }
    }

    @objc private func connectInBrowser() {
        let base = Settings.connection?.a ?? defaultWebApp
        if let url = URL(string: base + "?baglan=mac#/ayarlar") { NSWorkspace.shared.open(url) }
    }

    @objc private func connectFromField() {
        connect(code: codeField.stringValue)
    }

    @objc private func requestAccess() {
        requestAccessibility()
        if let url = URL(string: accessibilitySettingsURL) { NSWorkspace.shared.open(url) }
    }

    @objc private func close() {
        window?.close()
    }

    func windowWillClose(_ notification: Notification) {
        timer?.invalidate()
        timer = nil
        message = nil
    }
}

// MARK: - Uygulama

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private var statusItem: NSStatusItem!
    private var bubblePanel: FloatingPanel?
    private var bubbleView: BubbleView?
    private var toastPanel: FloatingPanel?
    private var toastTimer: Timer?
    private var lastExternalApp: NSRunningApplication?
    private var hotkeyMonitor: Any?
    private var penActive = false       // çizim kipi: kopyalanan her metin kaydedilir
    private var penChangeCount = 0
    private var clipboardTimer: Timer?
    private var clipboardCount = NSPasteboard.general.changeCount
    private var clipboardChangedAt: Date?   // pano en son ne zaman değişti (uygulama açıkken)
    private let onboarding = OnboardingController()
    private let smoke = CommandLine.arguments.contains("--smoke")

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Dock'ta simgesi olan normal bir uygulama: simgeye tıklayınca Derkenar penceresi açılır.
        NSApp.setActivationPolicy(.regular)
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

        // Panonun ne zaman değiştiğini izle: eski bir kopya yanlışlıkla alıntı diye kaydedilmesin.
        clipboardTimer = Timer.scheduledTimer(withTimeInterval: 0.4, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            let count = NSPasteboard.general.changeCount
            guard count != self.clipboardCount else { return }
            self.clipboardCount = count
            self.clipboardChangedAt = Date()
            if self.penActive, count != self.penChangeCount, let text = clipboardText() {
                self.penChangeCount = count
                self.save(text: text, colorKey: Settings.lastColor)
            }
        }
        onboarding.onConnected = { [weak self] in self?.refreshNames() }
        onboarding.onTrusted = { [weak self] in self?.installHotkey() }
        installHotkey()

        if smoke {
            onboarding.show(activate: false)
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            self.onboarding.show()
            if Settings.connection != nil {
                self.toast("Derkenar çalışıyor. Metni kopyala (⌘C), sonra bu düğmeye basıp renk seç.", seconds: 7)
            }
        }
        if Settings.connection != nil { refreshNames() }
    }

    // Dock simgesine ya da uygulamaya yeniden tıklanınca pencereyi göster.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        onboarding.show()
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return false
    }

    /// Tarayıcıdaki “Mac uygulamasını bağla” düğmesi derkenar://connect?code=... adresini açar.
    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls {
            if let code = connectionCode(fromURL: url) {
                onboarding.show()
                onboarding.connect(code: code)
            }
        }
    }

    /// ⌃⌥D: son kullanılan renkle kaydet. Genel tuş dinleme, Erişilebilirlik izni verildikten sonra çalışır.
    private func installHotkey() {
        guard hotkeyMonitor == nil, AXIsProcessTrusted() else { return }
        hotkeyMonitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            if flags == [.control, .option], event.charactersIgnoringModifiers?.lowercased() == "d" {
                DispatchQueue.main.async { self?.capture(colorKey: Settings.lastColor) }
            }
        }
    }

    @objc private func appActivated(_ note: Notification) {
        guard let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else { return }
        if app.processIdentifier != ProcessInfo.processInfo.processIdentifier { lastExternalApp = app }
    }

    // Yapıştırma (⌘V) gibi kısayolların bağlantı kodu penceresinde çalışması için.
    private func buildMainMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(actionItem("Derkenar penceresi", #selector(showOnboarding)))
        appMenu.addItem(.separator())
        let quitItem = NSMenuItem(title: "Derkenar'dan Çık", action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        appMenu.addItem(quitItem)
        appItem.submenu = appMenu
        main.addItem(appItem)
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
        let pen = actionItem("Çizim kipi: kopyaladığım her metni kaydet", #selector(togglePen))
        pen.state = penActive ? .on : .off
        pen.toolTip = "Açıkken ⌘C ile kopyaladığın her metin, son seçtiğin renkle kaydedilir."
        menu.addItem(pen)
        menu.addItem(.separator())
        menu.addItem(actionItem(Settings.connection != nil ? "Kurulum ve bağlantı…" : "⚠︎ Kurulumu tamamla…", #selector(showOnboarding)))
        menu.addItem(actionItem(Settings.bubbleHidden ? "Kenar düğmesini göster" : "Kenar düğmesini gizle", #selector(toggleBubble)))
        menu.addItem(actionItem("Kütüphaneyi aç", #selector(openLibrary)))
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
        else { onboarding.show() }
    }

    @objc private func showOnboarding() {
        onboarding.show()
    }

    @objc private func togglePen() {
        if penActive {
            penActive = false
            bubbleView?.armed = false
            toast("Çizim kipi kapandı")
            return
        }
        guard Settings.connection != nil else { onboarding.show(); return }
        penChangeCount = NSPasteboard.general.changeCount
        penActive = true
        bubbleView?.armed = true
        toast("Çizim kipi açık (\(Settings.name(for: Settings.lastColor))): metni seç, ⌘C'ye bas, kaydedilsin", seconds: 5)
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

    // MARK: Bağlantı

    private func refreshNames() {
        rpc("user_categories", [:]) { result in
            if case .success(let json) = result, let names = json as? [String: String] { Settings.names = names }
        }
    }

    // MARK: Yakalama

    /// Tek seferlik kayıt: izin varsa seçili metni okur, yoksa panodaki (⌘C ile kopyalanmış) metni kullanır.
    private func capture(colorKey: String) {
        guard Settings.connection != nil else {
            toast("Önce kütüphaneye bağlan", error: true)
            onboarding.show()
            return
        }
        Settings.lastColor = category(colorKey).key
        bubbleView?.ringColor = nsColor(hex: category(colorKey).hex)
        var text: String?
        if AXIsProcessTrusted(), let app = targetApp() { text = grabSelection(pid: app.processIdentifier) }
        if text == nil {
            // Yalnızca az önce kopyalanmış metin kabul edilir (son 3 dakika).
            if let changed = clipboardChangedAt, Date().timeIntervalSince(changed) < 180 { text = clipboardText() }
        }
        guard let found = text else {
            toast(AXIsProcessTrusted()
                ? "Seçili metin bulunamadı. Önce metni seç, sonra rengi seç."
                : "Önce metni seç ve kopyala (⌘C), sonra buradan rengi seç.", error: true, seconds: 6)
            return
        }
        // Çizim kipi açıksa bu metni ikinci kez kaydetmesin.
        penChangeCount = NSPasteboard.general.changeCount
        save(text: found, colorKey: colorKey)
    }

    private func targetApp() -> NSRunningApplication? {
        let front = NSWorkspace.shared.frontmostApplication
        if let app = front, app.processIdentifier != ProcessInfo.processInfo.processIdentifier { return app }
        return lastExternalApp
    }

    private func save(text: String, colorKey: String) {
        if text.count > 18000 { toast("Seçim çok uzun; daha kısa bir bölüm seç", error: true); return }
        let cat = category(colorKey)
        var context = CaptureContext()
        if let app = targetApp() { context = captureContext(app: app) }
        let captured = context
        // Sayfa numarası: metin PDF dosyasının içinde aranır (büyük kitaplarda bir iki saniye sürebilir).
        DispatchQueue.global(qos: .userInitiated).async {
            var resolved = captured
            if let path = captured.documentPath, let page = findPdfPage(path: path, text: text, hintPage: captured.page) {
                resolved.page = page
            }
            let payload = buildPayload(text: text, colorHex: cat.hex, context: resolved)
            let page = resolved.page
            DispatchQueue.main.async {
                rpc("capture", ["p_payload": payload]) { result in
                    switch result {
                    case .success(let json):
                        let duplicate = ((json as? [String: Any])?["duplicate"] as? Bool) ?? false
                        var message = duplicate ? "Bu alıntı zaten kayıtlıydı" : "Kaydedildi · \(Settings.name(for: cat.key))"
                        if !duplicate, let page = page { message += " · s. \(page)" }
                        self.toast(message)
                    case .failure(let error):
                        self.toast(describe(error), error: true)
                    }
                }
            }
        }
    }

    // MARK: Kenar düğmesi

    private func showBubble() {
        if bubblePanel == nil {
            let size: CGFloat = 58
            var origin = Settings.bubbleOrigin
            let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
            if origin == nil || !NSScreen.screens.contains(where: { $0.frame.contains(origin!) }) {
                origin = NSPoint(x: screen.maxX - size - 14, y: screen.midY - size / 2)
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

    private func toast(_ message: String, error: Bool = false, seconds: TimeInterval? = nil) {
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
        toastTimer = Timer.scheduledTimer(withTimeInterval: seconds ?? (error ? 5 : 2.4), repeats: false) { [weak self] _ in
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

    var link = URLComponents()
    link.scheme = "derkenar"
    link.host = "connect"
    link.queryItems = [URLQueryItem(name: "code", value: code)]
    check(link.url.flatMap { connectionCode(fromURL: $0) } == code, "bağlantı adresinden kodu alma")
    check(connectionCode(fromURL: URL(string: "derkenar://connect?code=YWJj%2BZGVm%2Fw%3D%3D")!) == "YWJj+ZGVm/w==", "adresteki kodun kaçış karakterleri çözülür")
    check(connectionCode(fromURL: URL(string: "derkenar://baska?code=abc")!) == nil && connectionCode(fromURL: URL(string: "https://connect?code=abc")!) == nil, "yabancı adres reddedilir")

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

    // Sayfa bulma: iki sayfalı gerçek bir PDF üretilir, metin içinde aranır.
    let pdfURL = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("derkenar-selftest.pdf")
    let pageTexts = [
        "Okumak, bir metnin içinden geçerken iz bırakmaktır. Altını çizdiğimiz her cümle, daha sonra döneceğimiz bir işarettir ve bu işaretler zamanla kişisel bir harita oluşturur.",
        "Visually, settings are realized by the presence of foreground and background. Figure 5.4 is an example, as it shows both the spatial arrangement with the teacher on a chair and the children on the floor, and the classroom setting.",
    ]
    var mediaBox = CGRect(x: 0, y: 0, width: 420, height: 595)
    if let pdfContext = CGContext(pdfURL as CFURL, mediaBox: &mediaBox, nil) {
        for pageText in pageTexts {
            pdfContext.beginPDFPage(nil)
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = NSGraphicsContext(cgContext: pdfContext, flipped: false)
            let font = NSFont(name: "Times New Roman", size: 14) ?? NSFont.systemFont(ofSize: 14)
            NSAttributedString(string: pageText, attributes: [.font: font]).draw(in: CGRect(x: 40, y: 60, width: 340, height: 480))
            NSGraphicsContext.restoreGraphicsState()
            pdfContext.endPDFPage()
        }
        pdfContext.closePDF()
        let path = pdfURL.path
        check(PDFDocument(url: pdfURL)?.pageCount == 2, "deneme PDF'i üretildi")
        check(findPdfPage(path: path, text: "Visually, settings are realized by the presence of foreground and background.") == "2", "PDF içinde sayfa bulma (2. sayfa)")
        check(findPdfPage(path: path, text: "Altını çizdiğimiz her cümle, daha sonra döneceğimiz bir işarettir") == "1", "PDF içinde sayfa bulma (1. sayfa, Türkçe)")
        check(findPdfPage(path: path, text: "it shows both the spatial arrangement with the teacher on a chair and the children on the floor") == "2", "satır sonunu aşan uzun alıntıda sayfa bulma")
        check(findPdfPage(path: path, text: "bu cümle belgede hiç geçmiyor ki") == nil, "belgede olmayan metin için sayfa yok")
        check(findPdfPage(path: "/olmayan/dosya.pdf", text: "metin") == nil, "okunamayan dosya için sayfa yok")
        try? FileManager.default.removeItem(at: pdfURL)
    } else {
        check(false, "deneme PDF'i üretilemedi")
    }

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
