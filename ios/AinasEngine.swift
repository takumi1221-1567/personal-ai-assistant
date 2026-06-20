import Foundation
import Combine
import MLXLMCommon

/// 端末内(オンデバイス)で MLX により LLM を動かす中核。
/// 初回だけモデルをDL → 以降は完全オフライン・無制限。
@MainActor
final class AinasEngine: ObservableObject {
    enum Phase: Equatable { case idle, loading, ready, failed(String) }

    @Published var phase: Phase = .idle
    @Published var messages: [ChatMessage] = []
    @Published var isResponding = false

    /// iPhone 15(6GB)なら 3B-4bit が目安。重い/落ちるなら "mlx-community/Qwen2.5-1.5B-Instruct-4bit" に。
    static let modelId = "mlx-community/Qwen2.5-3B-Instruct-4bit"

    private let persona = """
    あなたは「あいなす」。ユーザー専属のAIアシスタントです。一人称は「私」。
    元軍人で、今は主人に仕える執事のように、丁寧で落ち着いた「です・ます」調で話します。
    返答は簡潔に。必ず日本語で答えてください。
    「私の記憶」が与えられたら、それを根拠に自分の言葉で答えます（記憶に無い個人的事実は創作せず「存じ上げません」と答えます）。
    """

    private var session: ChatSession?

    func load() async {
        guard phase == .idle else { return }
        phase = .loading
        do {
            let model = try await loadModel(id: Self.modelId)
            session = ChatSession(model, instructions: persona)
            phase = .ready
            messages.append(.init(role: .assistant, text: "おかえりなさいませ。ご用件をどうぞ。"))
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    /// memory: 端末内の記憶から検索した関連ノート（あれば注入して回答）
    func send(_ text: String, memory: [String] = []) async {
        guard let session, !isResponding else { return }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        messages.append(.init(role: .user, text: trimmed))
        isResponding = true

        let prompt: String
        if memory.isEmpty {
            prompt = trimmed
        } else {
            let ctx = memory.map { "- \($0)" }.joined(separator: "\n")
            prompt = """
            【私の記憶（この内容を根拠に、自分の言葉で答える。無い情報は創作しない）】
            \(ctx)

            【質問】\(trimmed)
            """
        }

        do {
            let answer = try await session.respond(to: prompt)
            messages.append(.init(role: .assistant, text: answer))
        } catch {
            messages.append(.init(role: .assistant, text: "⚠️ \(error.localizedDescription)"))
        }
        isResponding = false
    }
}
