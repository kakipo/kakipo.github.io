---
layout: post
title: "fluentd -> Elasticsearch 大量データ転送でトラブル"
date: 2014-02-01 19:42:15 +0900
comments: true
categories: ["fluentd", "Kibana3", "Elasticsearch"]
---

概要
==========
- fluentd でサービスの情報を転送し、Kibana で分析したい
- これまでの過去データを一度に放り込みたい
- データの件数が合わない
- Kibana でエラーが発生する
- 各種設定を見直すことで対応可能


背景
==========
長い長いミーティングに疲れ、集中力を擦り減らしたアナタは
無意識のうちにブラウザを起動していました。

去年まで勤めていた会社の同僚がシェアした記事が目に止まります。

**「fluentd + Elasticsearch + Kibana で今どきのログ分析！」**

感化されやすいアナタはおもむろに VM を立ち上げ環境を構築します。
Web サーバから吐き出されたログはオシャレでイイ感じにチャート化され、
満足したアナタは VM を落とし、再び仕事に戻りました。

しばらく経ったある日のこと、ふと気づきます。
「ログだけじゃなくて、ユーザ属性の分析にもコレ使えそう。」

毎度オレオレ管理ページを作ることに疲れていたアナタは、
さっそくこの思いつきを行動に移しました。

が、簡単にはうまくいきません。
登録されるデータが想定より多かったり少なかったり。
Kibana はエラーメッセージを吐き出したり。
アナタは茨の道に踏み込んでしまったことに気づいたのです。


症状・原因・対策
==========

症状①: 登録される record が少ない
-----------
登録されたレコードが想定より少ない。
この場合、様々な原因が考えられます。

### 原因1: 大量 index 作成の負荷

Kibana はデフォルトでは `logstash-YYYY.MM.dd` 形式の index を期待しており、
fluent-plugin-elasticsearch もその形式で index を設定します。

今回のように過去のデータを一括で（新規に）登録しようする場合、
日数分の index を作成するために大きな負荷が発生し、
処理に失敗する可能性があります。

その際には以下のような `ProcessClusterEventTimeoutException` がログに追記されます。

``` text /var/log/elasticsearch/elasticsearch.log
[2014-01-31 11:57:46,255][DEBUG][action.admin.indices.create] [Mace, Gideon] [logstash-2013.06.13] failed to create
org.elasticsearch.cluster.metadata.ProcessClusterEventTimeoutException: failed to process cluster event (create-index [logstash-2013.06.13], cause [auto(bulk api)]) within 30s
    at org.elasticsearch.cluster.service.InternalClusterService$2$1.run(InternalClusterService.java:239)
    at java.util.concurrent.ThreadPoolExecutor.runWorker(ThreadPoolExecutor.java:1146)
    (...)
```

また、後述のように Elasticsearch では処理キュー数が閾値を超えた場合、
後続の処理を破棄される設定となっているために、index の作成自体がなされない可能性があります。

通常の利用シナリオではこのように一度に大量の index を作成することはあまりないため、問題になることは少ないでしょう。

#### 対策
今のところ Timeout までの設定値を変更することはできないようです。
あらかじめ必要となる index を作成しておきましょう。

#### 参考
- [ElasticSearch Users - ProcessClusterEventTimeoutException in Elasticsearch. Is this timeout value configurable? If yes how?](http://elasticsearch-users.115913.n3.nabble.com/ProcessClusterEventTimeoutException-in-Elasticsearch-Is-this-timeout-value-configurable-If-yes-how-td4048308.html)

### 原因2: 処理キューが閾値を超えた場合にリクエストを破棄する
Elasticsearch はデフォルトで閾値を超えたキューを破棄する設定となっています。
例えば index の作成は 50 個まで、bulk 処理は 20 個までといった具合。

メモリの消費を抑え適切に管理するための設定ではあるのですが、
この設定により作られるハズの index が作成されなかったり、
投入されるハズの record が作成されなかったりします。

#### 対策
Thread Pool のキューサイズを変更します。

``` yaml /etc/elasticsearch/elasticsearch.yml
# queue_size は実行するスレッドが存在せずペンディングされたリクエスト
# のキューの数の設定に使用します。キューが満杯の状態で
# リクエストが来た際には、そのリクエストは破棄されます。
# 制限をしたくない場合には -1 を設定してください。
threadpool.index.queue_size: -1 # デフォルト 200
threadpool.bulk.queue_size: -1 # デフォルト 50
# threadpool.search.queue_size: -1
# threadpool.get.queue_size: -1
```

_注) サーバのスペック、処理したいデータ量に応じて設定してください。_
_不適切な設定はメモリの過剰消費によるメモリ不足やスラッシングの原因となる可能性があります。_

#### 参考
- [Thread Pool [0.90]](http://www.elasticsearch.org/guide/en/elasticsearch/reference/current/modules-threadpool.html#modules-threadpool)
- [Set queue sizes by default on bulk/index thread pools · Issue #3888 · elasticsearch/elasticsearch](https://github.com/elasticsearch/elasticsearch/issues/3888)


### 原因3: データマッピングに失敗している
Elasticsearch は新たに投入される record を解析し、
動的にデータ型を規定します。その後規定された型と合わないデータを
投入しようとすると `MapperParsingException` が発生します。

特に「日付のようなフィールド」を日付型と認識される可能性が
あることに注意してください。

次のログは日付型のフィールドに空文字を設定しようとした場合に出力されました。

``` text /var/log/elasticsearch/elasticsearch.log
[2014-01-31 12:39:07,907][DEBUG][action.bulk              ] [Nicholas Scratch] [logstash-2013.09.18][1] failed     to execute bulk item (index) index {[logstash-2013.09.18][xxxx_type][xxxxx_id_0000], source[{....}]}
org.elasticsearch.index.mapper.MapperParsingException: failed to parse [xxx_day]
        at org.elasticsearch.index.mapper.core.AbstractFieldMapper.parse(AbstractFieldMapper.java:416)
(...)
Caused by: org.elasticsearch.index.mapper.MapperParsingException: failed to parse date field [], tried both date format [dateOptionalTime], and timestamp number with locale []
        at org.elasticsearch.index.mapper.core.DateFieldMapper.parseStringValue(DateFieldMapper.java:487)
        at
(...)
```


#### 対策
Elasticsearch の Default Mapping 設定を見直しましょう。
`default-mapping.json` という設定ファイルを作成することで、
デフォルトのマッピング設定を変更することが可能です。

``` json /etc/elasticsearch/default-mapping.json
{
    "_default_" : {
        "properties" : {
            "foo" : {"type" : "string"},
            "bar" : {"type" : "string"}
        }
    }
}
```


#### 参考
- [Root Object Type [0.90]](http://www.elasticsearch.org/guide/en/elasticsearch/reference/current/mapping-root-object-type.html)
- [Object Type [0.90]](http://www.elasticsearch.org/guide/en/elasticsearch/reference/current/mapping-object-type.html)
- [Core Types [0.90]](http://www.elasticsearch.org/guide/en/elasticsearch/reference/current/mapping-core-types.html)
- [Date Format [0.90]](http://www.elasticsearch.org/guide/en/elasticsearch/reference/current/mapping-date-format.html)

症状②: 逆に登録される record が多い
-----------

登録されたデータが想定より多い。
fluentd のログにリトライした形跡がある。

### 原因
Elasticsearch の負荷が高いため、登録処理自体は行われたものの
fluentd へのリプライに失敗。その後 fluentd がリトライを試み、
重複してデータが登録されたことが原因の可能性があります。

#### 対策
なかなか難しい問題です...
Elasticsearch 側でエラーが発生しないように頑張り、
ある程度の重複の発生を受け入れる or 頑張って削除するのが現実的でしょうか。

#### 参考
- [uken/fluent-plugin-elasticsearch](https://github.com/uken/fluent-plugin-elasticsearch)

症状③: Kibana で エラーが発生する（Parse Failure）
-----------
Kibana にて以下のようなエラーが発生する。

`Parse Failure [No mapping found for [@timestamp] in order to sort on]`

### 原因
空の index に対して検索を行い処理に失敗している可能性があります。
Kibana が生成するクエリの問題です。

#### 対策
record が存在しない空の index は削除しましょう。

#### 参考
- [[LOGSTASH-889] Empty indices throw error - logstash.jira.com](https://logstash.jira.com/browse/LOGSTASH-889)


症状4: Kibana で エラーが発生する（Could not contact Elasticsearch）
-----------
Kibana にて以下のエラーが発生する。

``` text
Error Could not contact Elasticsearch at http://x.x.x.x:9200. Please ensure that Elasticsearch is reachable from your system.
```

また、 Elasticsearch のログには以下のようなエラーが記録される。

``` text /var/log/elasticsearch/elasticsearch.log
[2014-01-31 13:58:28,444][WARN ][http.netty               ] [Nicholas Scratch] Caught exception while handling client http traffic, closing connection [id: 0xad362931, /x.x.x.x:36389 => /x.x.x.x:9200]
org.elasticsearch.common.netty.handler.codec.frame.TooLongFrameException: An HTTP line is larger than 4096 bytes.
        at org.elasticsearch.common.netty.handler.codec.http.HttpMessageDecoder.readLine(HttpMessageDecoder.java:642)
        at org.elasticsearch.common.netty.handler.codec.http.HttpMessageDecoder.decode(HttpMessageDecoder.java:182)
        (...)
```

### 原因
検索対象の index が多く、リクエスト URL の長さが規定値を上回っている可能性があります。
#### 対策
Elasticsearch の `max_initial_line_length` を設定します。

``` yaml /etc/elasticsearch/elasticsearch.yml
(...)
http.max_initial_line_length: 100k
```

#### 参考
- [HTTP [0.90]](http://www.elasticsearch.org/guide/en/elasticsearch/reference/current/modules-http.html)



（おまけ）Elasticsearch スニペット
==========
- 全 index の取得

    `curl -XGET http://localhost:9200/_aliases?pretty=1`

- type を指定して取得

    `curl -XGET 'http://localhost:9200/_all/my_type/_search?pretty'`

- 全 index の削除

    `curl -XDELETE 'http://localhost:5200/_all'`

- type を指定して削除

    `curl -XDELETE 'http://localhost:9200/_all/my_type/'`


参考
==========
- [blog.johtani.info/images/entries/20130830/IntroductionES20130829.pdf](http://blog.johtani.info/images/entries/20130830/IntroductionES20130829.pdf)
- [Elasticsearch Refresh Interval vs Indexing Performance | Sematext Blog](http://blog.sematext.com/2013/07/08/elasticsearch-refresh-interval-vs-indexing-performance/)
- [Object Type [0.90]](http://www.elasticsearch.org/guide/en/elasticsearch/reference/current/mapping-object-type.html)