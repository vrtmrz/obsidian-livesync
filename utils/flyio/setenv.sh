random_num() {
    echo $RANDOM
}
random_noun() {
    nouns=("waterfall" "river" "breeze" "moon" "rain" "wind" "sea" "morning" "snow" "lake" "sunset" "pine" "shadow" "leaf" "dawn" "glitter" "forest" "hill" "cloud" "meadow" "sun" "glade" "bird" "brook" "butterfly" "bush" "dew" "dust" "field" "fire" "flower" "firefly" "feather" "grass" "haze" "mountain" "night" "pond" "darkness" "snowflake" "silence" "sound" "sky" "shape" "surf" "thunder" "violet" "water" "wildflower" "wave" "water" "resonance" "sun" "log" "dream" "cherry" "tree" "fog" "frost" "voice" "paper" "frog" "smoke" "star")
    echo ${nouns[$(($RANDOM % ${#nouns[*]}))]}
}

random_adjective() {
    adjectives=("autumn" "hidden" "bitter" "misty" "silent" "empty" "dry" "dark" "summer" "icy" "delicate" "quiet" "white" "cool" "spring" "winter" "patient" "twilight" "dawn" "crimson" "wispy" "weathered" "blue" "billowing" "broken" "cold" "damp" "falling" "frosty" "green" "long" "late" "lingering" "bold" "little" "morning" "muddy" "old" "red" "rough" "still" "small" "sparkling" "thrumming" "shy" "wandering" "withered" "wild" "black" "young" "holy" "solitary" "fragrant" "aged" "snowy" "proud" "floral" "restless" "divine" "polished" "ancient" "purple" "lively" "nameless")
    echo ${adjectives[$(($RANDOM % ${#adjectives[*]}))]}
}

cp ./fly.template.toml ./fly.toml

if [ "$1" = "renew" ]; then
    unset appname
    unset username
    unset password
    unset database
    unset passphrase
    unset region
fi

[ -z $appname ] && export appname=$(random_adjective)-$(random_noun)-$(random_num)
[ -z $username ] && export username=$(random_adjective)-$(random_noun)-$(random_num)
[ -z $password ] && export password=$(random_adjective)-$(random_noun)-$(random_num)
[ -z $database ] && export database="obsidiannotes"
[ -z $passphrase ] && export passphrase=$(random_adjective)-$(random_noun)-$(random_num)
[ -z $region ] && export region="nrt"
