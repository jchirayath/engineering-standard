package fixture

import (
	"crypto/md5"
	"crypto/sha256"
	"crypto/tls"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
)

func f(db DB, id string) {
	// ruleid: std.go.print
	fmt.Println("hello")
	// ruleid: std.go.print
	log.Printf("x %s", id)
	// ok: std.go.print
	logger.Info("thing.done", "id", id)
	// ruleid: std.go.getenv
	_ = os.Getenv("API_URL")
	// ruleid: std.go.default-http-client
	_, _ = http.Get("https://example.com")
	// ruleid: std.go.default-http-client
	_ = &http.Client{}
	// ok: std.go.default-http-client
	_, _ = outbound.Get(ctx, "https://example.com")
	// ruleid: std.go.sql-sprintf
	db.Query(fmt.Sprintf("select * from t where id = '%s'", id))
	// ruleid: std.go.sql-sprintf
	db.ExecContext(ctx, "delete from t where id = "+id)
	// ok: std.go.sql-sprintf
	db.Query("select * from t where id = $1", id)
	// ruleid: std.go.tls-bypass
	_ = tls.Config{InsecureSkipVerify: true}
	err := work()
	// ruleid: std.go.ignored-error
	if err != nil {
	}
	// ok: std.go.ignored-error
	if err != nil {
		return
	}
}

func pitfalls(password string, name string) {
	// ruleid: std.go.math-rand-secret
	resetToken := rand.Int63()
	// ok: std.go.math-rand-secret
	jitter := rand.Intn(100)
	// ruleid: std.go.weak-password-hash
	h := sha256.Sum256([]byte(salt + password))
	// ok: std.go.weak-password-hash
	e := sha256.Sum256(body)
	// ruleid: std.go.shell-exec
	exec.Command("sh", "-c", "ls "+name)
	// ok: std.go.shell-exec
	exec.Command("ls", name)
	_, _, _, _ = resetToken, jitter, h, e
}

func cryptoControls(data []byte) {
	// ruleid: std.go.weak-crypto
	a := md5.Sum(data)
	// ok: std.go.weak-crypto
	b := sha256.Sum256(data)
	_, _ = a, b
}

