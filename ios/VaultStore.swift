import Foundation

struct VaultChunk: Codable, Hashable { let path: String; let chunk: String }

/// Obsidianの記憶を端末内に保存し、日本語キーワード検索する。
/// オンライン時に /api/vault/export から同期 → 以降オフラインでも参照可。
@MainActor
final class VaultStore: ObservableObject {
    @Published private(set) var chunks: [VaultChunk] = []
    @Published private(set) var lastSync: String?
    @Published var isSyncing = false

    var count: Int { chunks.count }

    private let fileURL: URL = FileManager.default
        .urls(for: .documentDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("vault.json")

    private static let synonyms: [String: String] = [
        "クロード": "claude", "ジェミニ": "gemini", "チャットジーピーティー": "chatgpt",
        "オープンエーアイ": "openai", "アンソロピック": "anthropic", "グーグル": "google",
        "ニュース": "news", "エーアイ": "ai"
    ]

    init() { load() }

    private func load() {
        if let data = try? Data(contentsOf: fileURL),
           let decoded = try? JSONDecoder().decode([VaultChunk].self, from: data) {
            chunks = decoded
        }
        lastSync = UserDefaults.standard.string(forKey: "vaultLastSync")
    }

    func sync(baseURL: String, password: String) async throws {
        guard let url = URL(string: "\(baseURL)/api/vault/export") else { throw err("URLが不正です") }
        isSyncing = true; defer { isSyncing = false }
        var req = URLRequest(url: url, timeoutInterval: 30)
        req.setValue(password, forHTTPHeaderField: "X-Ainas-Pass")
        let (data, resp) = try await URLSession.shared.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? -1
        guard code == 200 else { throw err(code == 401 ? "パスワードが違います" : "同期失敗 (HTTP \(code))") }
        struct Export: Decodable { let chunks: [VaultChunk] }
        let export = try JSONDecoder().decode(Export.self, from: data)
        chunks = export.chunks
        try? JSONEncoder().encode(chunks).write(to: fileURL)
        let now = ISO8601DateFormatter().string(from: Date())
        lastSync = now
        UserDefaults.standard.set(now, forKey: "vaultLastSync")
    }

    private func err(_ m: String) -> NSError {
        NSError(domain: "vault", code: 0, userInfo: [NSLocalizedDescriptionKey: m])
    }

    // MARK: - 検索（日本語キーワード＋パス重み付け）
    func search(_ query: String, limit: Int = 4) -> [String] {
        let terms = Self.extractKeywords(query)
        guard !terms.isEmpty, !chunks.isEmpty else { return [] }
        var scored: [(VaultChunk, Int)] = []
        for c in chunks {
            let pathL = c.path.lowercased()
            let bodyL = c.chunk.lowercased()
            var score = 0
            for t in terms {
                let tl = t.lowercased()
                if pathL.contains(tl) { score += 3 }
                else if bodyL.contains(tl) { score += 1 }
            }
            if score > 0 { scored.append((c, score)) }
        }
        scored.sort { $0.1 > $1.1 }
        return scored.prefix(limit).map { $0.0.chunk }
    }

    private static func extractKeywords(_ q: String) -> [String] {
        var terms = Set<String>()
        func matches(_ pattern: String) -> [String] {
            guard let re = try? NSRegularExpression(pattern: pattern) else { return [] }
            let ns = q as NSString
            return re.matches(in: q, range: NSRange(location: 0, length: ns.length))
                .map { ns.substring(with: $0.range) }
        }
        for w in matches("[A-Za-z0-9]{2,}") { terms.insert(w.lowercased()) }
        for w in matches("[\\p{Katakana}ー]{2,}") { terms.insert(w) }
        for run in matches("\\p{Han}{2,}") {
            terms.insert(run)
            let arr = Array(run)
            if arr.count >= 2 { for i in 0...(arr.count - 2) { terms.insert(String(arr[i...(i + 1)])) } }
        }
        for w in matches("\\p{Hiragana}{3,}") { terms.insert(w) }
        for t in Array(terms) { if let s = synonyms[t] { terms.insert(s) } }
        return Array(terms.prefix(28))
    }
}
