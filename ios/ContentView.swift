import SwiftUI

struct ContentView: View {
    @StateObject private var engine = AinasEngine()
    @StateObject private var vault = VaultStore()
    @State private var input = ""
    @State private var showSync = false
    @State private var syncMessage = ""
    @AppStorage("ainasBaseURL") private var baseURL = "https://YOUR-APP.pages.dev"
    @AppStorage("ainasPass") private var password = ""

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            switch engine.phase {
            case .idle, .loading: loadingView
            case .failed(let msg): failedView(msg)
            case .ready: chatView
            }
        }
        .task { await engine.load() }
        .sheet(isPresented: $showSync) { syncSheet }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Circle().fill(.purple).frame(width: 10, height: 10)
            VStack(alignment: .leading, spacing: 1) {
                Text("あいなす").font(.headline)
                Text(vault.count > 0 ? "記憶 \(vault.count)件・オフライン" : "記憶 未同期")
                    .font(.caption2).foregroundStyle(.secondary)
            }
            Spacer()
            Button { showSync = true } label: {
                Image(systemName: "arrow.triangle.2.circlepath").font(.title3)
            }
        }
        .padding(.horizontal).padding(.vertical, 10)
    }

    private var syncSheet: some View {
        NavigationStack {
            Form {
                Section("接続先") {
                    TextField("URL", text: $baseURL)
                        .autocorrectionDisabled().textInputAutocapitalization(.never)
                }
                Section("パスワード（AINAS-3.0のログインPW）") {
                    SecureField("パスワード", text: $password)
                }
                Section {
                    Button {
                        Task {
                            do {
                                try await vault.sync(baseURL: baseURL, password: password)
                                syncMessage = "✅ 同期完了：記憶 \(vault.count)件"
                            } catch {
                                syncMessage = "⚠️ \(error.localizedDescription)"
                            }
                        }
                    } label: {
                        HStack { if vault.isSyncing { ProgressView() }; Text("記憶を同期する") }
                    }
                    .disabled(vault.isSyncing || password.isEmpty)
                    if !syncMessage.isEmpty { Text(syncMessage).font(.caption) }
                    if let ls = vault.lastSync {
                        Text("最終同期: \(ls)").font(.caption2).foregroundStyle(.secondary)
                    }
                }
                Section { Text("一度同期すれば、オフラインでも記憶を参照して答えます。").font(.caption2).foregroundStyle(.secondary) }
            }
            .navigationTitle("記憶の同期")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("閉じる") { showSync = false } } }
        }
    }

    private var loadingView: some View {
        VStack(spacing: 14) {
            Spacer()
            ProgressView()
            Text("モデルを準備しています…")
            Text("初回はダウンロードで数分かかります（Wi-Fi推奨）。\n2回目以降はオフラインで即起動します。")
                .font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center)
            Spacer()
        }.padding()
    }

    private func failedView(_ msg: String) -> some View {
        VStack(spacing: 14) {
            Spacer()
            Image(systemName: "exclamationmark.triangle").font(.largeTitle).foregroundStyle(.orange)
            Text("読み込みに失敗しました").font(.headline)
            Text(msg).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center).padding(.horizontal)
            Text("メモリ不足の場合は AinasEngine.modelId をより小さいモデルに変更してください。")
                .font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.center).padding(.horizontal)
            Spacer()
        }.padding()
    }

    private var chatView: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(engine.messages) { msg in bubble(msg).id(msg.id) }
                        if engine.isResponding {
                            HStack { ProgressView(); Text("考えています…").font(.caption).foregroundStyle(.secondary); Spacer() }
                                .padding(.horizontal)
                        }
                    }.padding()
                }
                .onChange(of: engine.messages.count) {
                    if let last = engine.messages.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
                }
            }
            inputBar
        }
    }

    private func bubble(_ msg: ChatMessage) -> some View {
        HStack {
            if msg.role == .user { Spacer(minLength: 40) }
            Text(msg.text.isEmpty ? " " : msg.text)
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(msg.role == .user ? Color.purple : Color(.secondarySystemBackground),
                            in: RoundedRectangle(cornerRadius: 16))
                .foregroundStyle(msg.role == .user ? .white : .primary)
            if msg.role == .assistant { Spacer(minLength: 40) }
        }
    }

    private var inputBar: some View {
        HStack(spacing: 8) {
            TextField("メッセージを入力…", text: $input, axis: .vertical)
                .lineLimit(1...5)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 18))
            Button {
                let t = input; input = ""
                let mem = vault.search(t)
                Task { await engine.send(t, memory: mem) }
            } label: { Image(systemName: "arrow.up.circle.fill").font(.title) }
            .disabled(input.trimmingCharacters(in: .whitespaces).isEmpty || engine.isResponding)
        }
        .padding(.horizontal).padding(.vertical, 8)
    }
}

#Preview { ContentView() }
