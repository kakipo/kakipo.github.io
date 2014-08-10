---
layout: post
title: "Docker 初心者は phusion/baseimage-docker を使おう"
date: 2014-08-10 08:44:51 +0900
comments: true
categories: docker
---

tl;dr
=====

Docker 初心者は [phusion/baseimage-docker](https://github.com/phusion/baseimage-docker) をベースイメージとして使おう。  
色々と便利だしハマる機会が減る。


遅ればせながら Docker 入門した
======

新たにアプリケーションを作る機会があり、週末を利用し遅ればせながら Docker について調べた。  
すでにネット上に多くの入門記事がアップされていたおかげで導入自体は簡単にできたが、「まともな」イメージを作成しようとすると壁にぶちあたることになった。たとえば...

- コンテナに ssh 接続するにはどうすればいいの？
- syslog 起動してないの？
- cron は？
- 解析のために fluentd とか newrelic agent とかも入れたいな...

いずれも 1 コンテナ 1 プロセスしか許容されていないという思い込みによるもので、Docker 入門者の多くが通る道なようだ。  

公式ドキュメントをちゃんと読めば複数プロセスを生やすために Supervisor を利用する方法が紹介されている。  

[Using Supervisor - Docker Documentation](https://docs.docker.com/articles/using_supervisord/)

まぁ、これはこれで良いのだけれど個人的には [phusion/baseimage-docker](https://github.com/phusion/baseimage-docker) の利用をオススメしたい。  

複数プロセス管理以外にも Docker を使う上で便利な各種ツールや様々な問題を回避するための仕組みが用意されている。  

積極的に巨人の肩に乗るべきだ。特に自分のような初心者は。


phusion/baseimage-docker とは
======

phusion/baseimage-docker（以下 baseimage-docker） とは [Phusion Passenger](https://www.phusionpassenger.com/) という有名なソフトウェアを作成している Phusion が開発を続けている Docker イメージだ。  

Phusion Passenger 自体は Rails アプリ開発者であれば一度は目にしたことがあると思う。Nginx や Apache の設定ファイルにちょろっと書くだけで、それらがアプリサーバに変わって動作してくれるという画期的なソフトウェアだ。公式サイトを見たら Python や Node.js にも対応しているらしい。知らなかった。  

話がそれた。  

baseimage-docker の利点として先にも述べたように、Docker を利用するにあたってぶち当たるであろう様々な問題を回避するための仕組みが用意されている。

いくつか紹介したい。

- 正しい init プロセス  
    Unix プロセスモデルでは init プロセス (PID 1) はすべての孤児プロセス（親プロセスが終了したプロセス）を回収し、正しく終了するという責務がある。しかしほとんどの Docker コンテナはこれを正しく行えていないために、ゾンビプロセスが発生しうる。  
    また、 `docker stop` は 全プロセスを終了するために `SIGTERM` を init プロセスに送るのだが、残念ながらほとんどの init システムはハードウェアシャットダウンを前提としており Docker 内で正しく動作しない。これによりプロセスは `SIGKILL` によって殺され、正常終了せず、ファイルの破損が発生しうる。  
    baseimage-docker は `/sbin/my_init` という init プロセスを利用することによってこれらの問題に対応する。

- syslog-ng  
    syslog はどんな場合でも必要だろう。baseimage-docker にははじめから syslog-ng が同梱されている。

- SSH Server  
    Docker には nsenter というツールが用意されているが、いくつか問題もある。使い慣れた SSH が利用できるのであれば幸せだ。baseimage-docker はデフォルトで SSH を利用でき、気になる場合には実行しないことも可能だ。（後述）

- cron  
    あると何かと役に立つだろう。

- runit  
    複数プロセスの管理に利用する。起動スクリプトをちょろっと書いて特定フォルダにいれるだけで良いのが有り難い（後述）

- setuser  
    特定のコマンドを別ユーザで実行するための便利ツール。 `su` より使いやすい。

init プロセス云々で分かるように Docker を使おうと思えば、一定の UNIX の知識を要する。これが過渡的なものなのか、そのうち解決されて誰でも気軽に使えるようになるのかは分からないけれど。

以下ではより詳しく baseimage-docker について紹介したい。


複数プロセスを管理する
=====

baseimage-docker では `/etc/service/<サービス名>` に `run` という名前をつけたシェルスクリプトをおくだけで、デーモンとして起動してくれるようになる。

公式よりサンプルを引用。
memcache ユーザで memcached を起動するスクリプト。

``` sh
### In memcached.sh (make sure this file is chmod +x):
#!/bin/sh
# `/sbin/setuser memcache` runs the given command as the user `memcache`.
# If you omit that part, the command will be run as root.
exec /sbin/setuser memcache /usr/bin/memcached >>/var/log/memcached.log 2>&1

### In Dockerfile:
RUN mkdir /etc/service/memcached
ADD memcached.sh /etc/service/memcached/run
```

注意

- デーモンは（デモナイズしたりフォークしたりするのではなく）フォアグラウンドで起動すること
- スクリプトは実行許可を与えること（`chmod +x`）

起動時にスクリプトを実行する
=====

baseimage-docker では `/etc/my_init.d/` にシェルスクリプトをおくだけで、起動時に実行してくれる。

公式よりサンプルを引用。
起動した時間を記録するシンプルなスクリプト。

``` sh 
### In logtime.sh (make sure this file is chmod +x):
#!/bin/sh
date > /tmp/boottime.txt

### In Dockerfile:
RUN mkdir -p /etc/my_init.d
ADD logtime.sh /etc/my_init.d/logtime.sh
```


注意

- スクリプトは実行許可を与えること（`chmod +x`）
- スクリプトは必ず正常終了させること。0 以外の exit コードで終了すると起動に失敗する。
- スクリプトはデーモンプロセス起動 *前* に実行される


環境変数の管理
======

baseimage-docker は環境変数を `/etc/container_environment` にいくつかの形式でファイルとしてダンプしてくれる。
これの何が嬉しいか。Nginx など子プロセスを生成する際にそれらに環境変数を隠してしまうサービスを利用する場合に、元々の環境変数を利用できるようになるのだ。

詳しくは wiki を参照されたい。

[phusion/baseimage-docker](https://github.com/phusion/baseimage-docker#environment-variables)

SSH で接続する
======

Docker に sshd を起動するかどうかは結構議論の分かれる部分だと思う。Immutable という観点では理想的には不要なのだろう。
が、現実的には管理のために接続の手段は用意しておいた方が便利だろう。セキュリティという観点では別のレイヤー（VPC 上のセキュリティグループなど）で担保できると思う。  

baseimage-docker ではデフォルトで sshd が起動している。


sshd を起動したくない場合は以下を `Dockerfile` に追記しよう。

``` text Dockerfile
RUN rm -rf /etc/service/sshd /etc/my_init.d/00_regen_ssh_host_keys.sh
```

nsenter の利点と欠点
======

sshd を起動するまでもなく nsenter というツールを利用すれば、docker コンテナ内でコマンドを実行することができる。

[jpetazzo/nsenter](https://github.com/jpetazzo/nsenter)


利点
-----

- コンテナ内で sshd の起動が不要
- ssh キー設定が不要
- どんなコンテナでも利用可能

欠点
-----

- nsenter によって実行されたプロセスは通常時と少々異なる振る舞いをする。例えば、コンテナ内のプロセスから kill することができない。子プロセスについても同様。
- nsenter プロセスがシグナルによって終了した場合（例: kill コマンドによって）nsenter によって実行されたコマンドは殺されないし、クリーンアップも行われない。
- 別のツールを学ぶ必要がある
- Docker host の root 権限が必要
- nsenter ツールが必要


まぁ、でも個人的には新たなツールをいれたくないので ssh で良いかなと思っている。


`docker-bash` ツール
======

ssh で接続する際の一般的な流れは、こんなものだろう。

1. `docker ps` で実行中のコンテナ ID を調べて
2. `docker inspect -f "{{ .State.Pid }}" <ContainerID>` で IP 調べて
3. `ssh -i /path/to/yourkey root@CONTAINER_IP_ADDR`

しかし `Dockerfile` を書きつつ環境構築している際にはこの手順がヒジョーに煩わしくなる。

`docker-bash` ツールを使えば手順はもっと単純になる。

インストールも簡単だ。

``` text
curl --fail -L -O https://github.com/phusion/baseimage-docker/archive/master.tar.gz && \
tar xzf master.tar.gz && \
sudo ./baseimage-docker-master/install-tools.sh
```

実行するには

``` sh
docker-bash YOUR-CONTAINER-ID
```

で SSH 接続できる。

直近のコンテナ ID を取得するエイリアスを定義するともっと便利だ。

``` sh
alias dl="docker ps --latest --quiet"
```

上記を `.bashrc` などに定義すると、

``` sh
docker-bash `dl`
```

一発で接続できる。


終わりに
======

Docker はクセが強く、また現時点では UNIX に関する深い知識が要求される。
初心者が一からイメージを作るのは、練習であれば全く問題ないが、
実用を考えるのであれば、とりあえずは [phusion/baseimage-docker](https://github.com/phusion/baseimage-docker#environment-variables) からイメージを作ってみよう。
オリジナルイメージを作成するのは慣れてからでも、Docker のバージョンアップを待ってからでも遅くないハズだ。  

また、Ruby や Python や Node.js を利用する場合には、同じく Phusion が用意している [phusion/passenger-docker](https://github.com/phusion/passenger-docker) を利用すると良い。
これは phusion/baseimage-docker を拡張したもので、様々な便利ライブラリが同梱されている（ruby, python, node.js, git, その他言語毎に必要なライブラリ）。  

Docker とは別に Nginx + Phusion Passenger でも色々とハマるのでそのうち記事を書きたいと思う。





