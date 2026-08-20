# Premier League Ranking Prediction 2026/27

2026/27 Premier League の順位予想をみんなで共有する GitHub Pages サイトです。

## 機能

- 現在順位の表示
- 参加者ランキング（予想順位と現在順位の差の合計。小さいほど上位）
- 完全的中数の表示
- 参加者ごとの20クラブ予想詳細
- 20クラブをドラッグ / ↑↓ボタンで並べ替える予想フォーム
- GitHub Issue を使った予想投稿
- Issue投稿から `data/predictions.json` へ自動反映する GitHub Actions
- GitHub Pages 自動デプロイ

## GitHub Pages

リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** に設定してください。

公開URL:

`https://tnkytr1182-bit.github.io/-premier-league-ranking-prediction/`

## 現在順位の更新

`data/standings.json` を更新して main に反映すると、Pages が自動再デプロイされます。

_Last deployment trigger: 2026-08-20_
