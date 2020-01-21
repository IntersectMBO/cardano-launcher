{ pkgs ? import <nixpkgs> {} }:

with pkgs;

mkShell {
  # inputsFrom = with pkgs; [ hello gnutar ];
  buildInputs = [ openssl zlib pkgconfig npm yarn ];
}
