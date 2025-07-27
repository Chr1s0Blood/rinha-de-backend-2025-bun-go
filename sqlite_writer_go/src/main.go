package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"os"

	"github.com/joho/godotenv"
	_ "github.com/mattn/go-sqlite3"
	"github.com/nats-io/nats.go"
)

type RequestSQL struct {
	SQL    string        `json:"sql"`
	Params []interface{} `json:"params"`
}

func main() {
	// Carregar .env apenas se o arquivo existir (opcional para Docker)
	if err := godotenv.Load(); err != nil {
		log.Println("Arquivo .env não encontrado, usando variáveis de ambiente do sistema")
	}

	nc, err := connectNATS()
	if err != nil {
		log.Fatal("Erro ao conectar NATS:", err)
	}
	defer nc.Close()

	db, err := connectSQLite()
	if err != nil {
		log.Fatal("Erro ao conectar SQLite:", err)
	}
	defer db.Close()

	_, err = nc.Subscribe("sqlite-requests", func(msg *nats.Msg) {
		var request RequestSQL
		if err := json.Unmarshal(msg.Data, &request); err != nil {
			log.Printf("Erro unmarshaling JSON: %v", err)
			return
		}

		if err := executeSQL(request.SQL, request.Params, db); err != nil {
			log.Printf("Erro exec SQL: %v", err)
		}
	})
	if err != nil {
		log.Fatal("Erro subscriber NATS:", err)
	}

	log.Println("Waiting SQLite requests...")
	select {}
}

func connectNATS() (*nats.Conn, error) {
	natsURL := os.Getenv("NATS_URL")
	nc, err := nats.Connect(natsURL)
	return nc, err
}

func connectSQLite() (*sql.DB, error) {
	databaseURL := os.Getenv("DATABASE_URL")
	db, err := sql.Open("sqlite3", databaseURL)
	if err != nil {
		return nil, err
	}
	return db, nil
}

func executeSQL(sqlQuery string, params []interface{}, db *sql.DB) error {
	_, err := db.Exec(sqlQuery, params...)
	return err
}
