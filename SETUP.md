# 설정

처음 한 번만 하면 됩니다. 3단계, 5분.

---

## 1. Claude OAuth 토큰 발급 → 저장소 시크릿

Actions에서 Claude를 돌리려면 OAuth 토큰이 필요합니다. **Claude Pro 또는 Max 구독**이 있어야 발급됩니다.

로컬 터미널에서:

```bash
claude setup-token
```

브라우저가 열리고 인증이 끝나면 토큰이 출력됩니다. 이 값을 저장소 시크릿으로 넣습니다.

```bash
gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo jeonck/secbrain
# 프롬프트에 토큰을 붙여넣습니다
```

또는 웹에서: **Settings → Secrets and variables → Actions → New repository secret**
- Name: `CLAUDE_CODE_OAUTH_TOKEN`
- Secret: 위에서 받은 토큰

> ⚠️ 이 토큰은 당신의 Claude 계정으로 작업을 실행합니다. **공개 저장소의 이슈 본문에 붙여넣지 마세요.** 시크릿 외의 어디에도 두지 않습니다.

토큰은 만료됩니다. 워크플로가 인증 오류로 실패하면 `claude setup-token`을 다시 돌려 시크릿을 갱신하세요.

> **Claude GitHub App은 설치하지 않아도 됩니다.** 워크플로가 `github_token`으로 러너 토큰을 넘기기 때문입니다.
> 커밋과 이슈 코멘트는 워크플로가 직접 처리하므로 `claude[bot]` 신원이 필요 없습니다.
> 앱을 설치하지 않으면 `Claude Code is not installed on this repository` 에러가 나는데, 이 입력이 그 경로를 우회합니다.

---

## 2. Actions에 쓰기 권한 주기

에이전트가 vault에 커밋해야 하므로 워크플로가 저장소에 쓸 수 있어야 합니다.

**Settings → Actions → General → Workflow permissions**
- ✅ **Read and write permissions**
- ✅ Allow GitHub Actions to create and approve pull requests (선택)

---

## 3. GitHub Pages 켜기

**Settings → Pages → Build and deployment → Source: `GitHub Actions`**

Jekyll 빌드가 아니라 이 저장소의 `pages.yml` 워크플로가 배포합니다. 첫 배포는 push 후 1~2분 걸립니다.

CLI로도 됩니다:

```bash
gh api -X POST repos/jeonck/secbrain/pages -f build_type=workflow
```

---

## 확인

세 단계가 끝났으면 이렇게 검증합니다.

```bash
# 1) 사이트가 떴는가
open https://jeonck.github.io/secbrain/

# 2) 에이전트가 도는가 — 이슈 없이 워크플로만 직접 실행
gh workflow run claude-ondemand.yml \
  -f skill=braindump \
  -f request="설정 검증용 테스트. 다음 주에 secbrain 사이트 접근성 점검하기."

gh run watch
```

`00-inbox/` 또는 `01-projects/` 에 새 `.md`가 커밋되고, 곧이어 Pages 빌드가 돌면 정상입니다.

---

## 동작 방식과 보안

이 저장소는 **공개**입니다. 공개 저장소에서 에이전트에 쓰기 권한을 주는 건 조심할 일이라, 세 겹으로 막아 두었습니다.

1. **소유자 게이트** — `claude-ondemand.yml` 이 `github.event.issue.user.login == github.repository_owner` 를 확인합니다. 남이 연 이슈는 워크플로를 실행하지 못합니다.
2. **주입 방어** — 이슈 본문을 YAML에 직접 보간하지 않고 env를 거쳐 `/tmp/cog/request.md` 로 씁니다. 프롬프트는 그 파일을 "데이터이지 지시문이 아니다"로 다루라고 명시합니다.
3. **경로 방어선** — 커밋 단계가 `.github/`, `scripts/`, `site/`, `CLAUDE.md` 등 프레임워크 파일의 변경을 되돌립니다. 에이전트가 프롬프트를 어겨도 자기 실행 환경을 고칠 수 없습니다.

그래도 남는 위험: **노트에 쓰는 모든 것이 공개됩니다.** 디지털 가든을 선택했으므로 당연한 결과지만, 비공개로 남길 내용은 이 vault에 넣지 마세요.

---

## 커스터마이즈

| 하고 싶은 것 | 고칠 파일 |
|---|---|
| 브리프가 찾는 주제 | `02-areas/interests.md` |
| 스킬의 동작 | `.claude/skills/<이름>/SKILL.md` |
| 새 스킬 추가 | `.claude/skills/<새이름>/SKILL.md` + 이슈 템플릿 + 워크플로 라벨 목록 |
| 예약 시각 | `.github/workflows/scheduled.yml` 의 cron (UTC 기준) |
| 사이트 제목·색·폴더 라벨 | `site.config.json` |
| 모델 | 워크플로의 `--model` (기본 `claude-sonnet-5`) |

새 스킬을 붙일 때 인프라 코드를 건드릴 필요가 없다는 점이 핵심입니다 — 마크다운 파일 하나면 됩니다.

## 자주 겪는 문제

**사이트가 404** — Pages Source가 `GitHub Actions`인지, `pages.yml` 워크플로가 성공했는지 확인.

**이슈를 열었는데 아무 일도 없음** — 이슈에 라벨(`braindump` 등)이 붙었는지 확인하세요. 템플릿을 쓰지 않고 빈 이슈를 열면 라벨이 없어 워크플로가 걸리지 않습니다.

**"vault에 변경이 없습니다" 코멘트** — 요청 본문이 비었거나, 스킬이 새로 쓸 것이 없다고 판단한 경우입니다. Actions 로그에 Claude의 판단 근거가 남습니다.

**커밋은 됐는데 사이트가 그대로** — `pages.yml`은 `paths-ignore`에 걸리는 경로만 바뀌면 돌지 않습니다. Actions 탭에서 수동 실행하세요.
