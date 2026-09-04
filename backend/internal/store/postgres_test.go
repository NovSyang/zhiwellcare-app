package store

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"zhiwellcare/backend/internal/auth"
)

// TestPostgresStore 在配置 APP_TEST_DB_URL 时跑真库集成用例（否则跳过）。
func TestPostgresStore(t *testing.T) {
	dbURL := os.Getenv("APP_TEST_DB_URL")
	if dbURL == "" {
		t.Skip("未配置 APP_TEST_DB_URL，跳过 PostgreSQL 集成测试")
	}
	ctx := context.Background()
	pg, err := NewPostgres(ctx, dbURL)
	if err != nil {
		t.Fatalf("连接失败: %v", err)
	}
	defer pg.Close()

	if err := pg.RunMigrations(ctx, migrationsDir(t)); err != nil {
		t.Fatalf("迁移失败: %v", err)
	}

	phone := fmt.Sprintf("139%08d", time.Now().UnixNano()%100000000)
	hash, _ := auth.HashPassword("abc123")
	user, err := pg.CreateUser(ctx, CreateUserParams{Phone: phone, PasswordHash: hash, Nickname: "集成"})
	if err != nil {
		t.Fatalf("创建用户失败: %v", err)
	}
	if _, err := pg.CreateUser(ctx, CreateUserParams{Phone: phone, PasswordHash: hash}); err != ErrPhoneExists {
		t.Fatalf("重复手机号应返回 ErrPhoneExists，实际 %v", err)
	}

	found, err := pg.GetUserByPhone(ctx, phone)
	if err != nil || found.ID != user.ID {
		t.Fatalf("按手机号查询异常: %v %v", found, err)
	}
	if found.PasswordHash == "" {
		t.Fatal("密码哈希未返回")
	}

	if err := pg.UpdateNickname(ctx, user.ID, "新昵称"); err != nil {
		t.Fatalf("改昵称失败: %v", err)
	}
	after, err := pg.GetUserByID(ctx, user.ID)
	if err != nil || after.Nickname != "新昵称" {
		t.Fatalf("昵称更新未生效: %v %v", after, err)
	}

	// 刷新令牌入库/查询/撤销
	raw, _ := auth.NewRefreshSecret()
	hashToken := auth.HashRefreshToken(raw)
	expires := time.Now().Add(time.Hour)
	if err := pg.Save(ctx, user.ID, hashToken, expires); err != nil {
		t.Fatalf("保存刷新令牌失败: %v", err)
	}
	row, err := pg.FindByHash(ctx, hashToken)
	if err != nil || row.UserID != user.ID {
		t.Fatalf("查询刷新令牌失败: %v %v", row, err)
	}
	if err := pg.Revoke(ctx, hashToken); err != nil {
		t.Fatalf("撤销失败: %v", err)
	}
	revoked, _ := pg.FindByHash(ctx, hashToken)
	if revoked.RevokedAt == nil {
		t.Fatal("撤销时间未写入")
	}
}

// migrationsDir 依据测试文件位置定位仓库根下的 migrations 目录。
func migrationsDir(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("无法定位测试文件")
	}
	return filepath.Join(filepath.Dir(file), "..", "..", "migrations")
}
