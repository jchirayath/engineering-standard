package fixture

import (
	"crypto/tls"
	"fmt"
	"log"
	"net/http"
	"os"
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
