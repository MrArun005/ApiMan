*** Settings ***
Documentation     ApiMan's REST API: collections and environments are JSON files in the data folder.
Resource          ../../resources/apiman.resource
Suite Setup       Open ApiMan Session
Suite Teardown    Run Keywords    Delete All Sessions    AND    Stop ApiMan Under Test
Test Tags         api

*** Test Cases ***
Info Reports The Data Folder
    ${r}=    GET On Session    apiman    /api/info
    Dictionary Should Contain Key    ${r.json()}    dataDir

Create Read Update And Delete A Collection
    [Tags]    smoke
    ${coll}=    Load Test Data    create-collection.json    collection
    ${id}=    Create Collection    ${coll}
    ${r}=    GET On Session    apiman    /api/collections/${id}
    Should Be Equal    ${r.json()}[info][name]    Robot Smoke
    Length Should Be    ${r.json()}[item]    2
    Append To List    ${coll}[item]    ${{ {"name": "Delete user", "request": {"method": "DELETE", "url": "{{baseUrl}}/users/1"}} }}
    PUT On Session    apiman    /api/collections/${id}    json=${coll}    expected_status=200
    ${r}=    GET On Session    apiman    /api/collections/${id}
    Length Should Be    ${r.json()}[item]    3
    Delete Collection    ${id}
    GET On Session    apiman    /api/collections/${id}    expected_status=404

Lists Every Collection
    ${coll}=    Load Test Data    create-collection.json    collection
    ${id}=    Create Collection    ${coll}
    ${r}=    GET On Session    apiman    /api/collections
    ${ids}=    Evaluate    [c["id"] for c in $r.json()]
    List Should Contain Value    ${ids}    ${id}
    [Teardown]    Delete Collection    ${id}

Rejects A File That Is Not A Collection
    ${body}=    Evaluate    {"collection": {"values": []}}
    ${r}=    POST On Session    apiman    /api/collections    json=${body}    expected_status=400
    Should Contain    ${r.json()}[error]    collection

Refuses Calls Without The Session Token
    [Tags]    security
    GET    ${BASE_URL}/api/collections    expected_status=403

Environments From Test Data
    [Documentation]    Data-driven: one environment per row of testdata/environments.json.
    ${rows}=    Load Test Data    environments.json
    FOR    ${row}    IN    @{rows}
        ${values}=    Evaluate    [{"key": "baseUrl", "value": $row["baseUrl"], "enabled": True}]
        ${doc}=    Create Dictionary    name=${row}[name]    values=${values}
        ${body}=    Create Dictionary    document=${doc}
        ${r}=    POST On Session    apiman    /api/environments    json=${body}    expected_status=201
        ${id}=    Set Variable    ${r.json()}[id]
        ${r}=    GET On Session    apiman    /api/environments/${id}
        Should Be Equal    ${r.json()}[values][0][value]    ${row}[baseUrl]
        DELETE On Session    apiman    /api/environments/${id}
    END
